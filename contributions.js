import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Octokit } from 'octokit'
import ansiEscapes from 'ansi-escapes'
import merge from 'lodash/merge.js'

const octokit = new Octokit({ auth: process.env.GITHUB_AUTH_TOKEN })
const DATES_FILE = './data/dates.json'
const PULL_REQUESTS_FILE = './data/pull_requests.json'
const REPOSITORIES_FILE = './data/repositories.json'
const COMMITS_FILE = './data/commits.json'
const CONTRIBUTIONS_FILE = './contributions.md'
const config = {
	owner: 'hyperupcall',
	excludeArray: [
		'JasperNelson',
		'hyperupcall',
		'eankeen',
		'eshsrobotics',
		'orangeyiestfruit',
		'fox-',
		'rapidotapp',
		'ecc-cs-club',
		'bash-bastion',
		'davidNicolas-cecs/OED',
		'uakotaobi',
	],
}

/**
 * @param {string} file
 * @param {Record<PropertyKey, unknown>} newJson
 */
async function updateFile(file, newJson) {
	const oldJson = JSON.parse(await fs.readFile(file, 'utf-8'))
	const json = merge(oldJson, newJson)
	await fs.writeFile(file, JSON.stringify(json, null, '\t'))
}

/**
 * @param {string} html_url
 * @returns {{ owner: string, repoName: string }}
 */
function getURLData(html_url) {
	const match = html_url.match(/^https:\/\/github\.com\/(?<owner>.*?)\/(?<repo>.*?)\//u)
	const owner = match.groups?.['owner']
	const repoName = match.groups?.['repo']

	return {
		owner,
		repoName,
	}
}

/**
 * @param {string} repo
 */
function isExcludedRepository(repo) {
	for (const excludedString of config.excludeArray) {
		if (repo.includes(excludedString)) {
			return true
		}
	}

	return false
}

{
	// Create files
	for (const file of [DATES_FILE, PULL_REQUESTS_FILE, REPOSITORIES_FILE, COMMITS_FILE]) {
		try {
			await fs.stat(file)
		} catch {
			await fs.mkdir(path.dirname(file), { recursive: true })
			await fs.writeFile(file, '{}\n')
		}
	}
}

{
	// Get all pull requests for owner
	const Prs =
		JSON.parse(await fs.readFile(PULL_REQUESTS_FILE, 'utf-8')).pullRequests ?? []
	const datesJson = JSON.parse(await fs.readFile(DATES_FILE, 'utf-8'))
	let createdAt = ''
	if (datesJson?.pull_requests) {
		createdAt = `created:>${datesJson.pull_requests}`
	}

	const iterator = octokit.paginate.iterator(octokit.rest.search.issuesAndPullRequests, {
		q: `is:pr author:${config.owner} ${createdAt}`,
		sort: 'created',
		order: 'asc',
	})
	for await (const { data: prs } of iterator) {
		for (const pr of prs) {
			const { owner, repoName } = getURLData(pr.html_url)
			const createdAt = new Date(pr.created_at)
			const millisecondsInADay = 24 * 60 * 60 * 1000
			const lastSearched = new Date(createdAt - millisecondsInADay)

			const link = ansiEscapes.link(
				`${owner}/${repoName}/pulls/${pr.number}`,
				pr.html_url,
			)
			console.log(`Processing ${createdAt.toISOString()} (${link})`)
			if (
				!Prs.some((item) => {
					return item.node_id === pr.node_id
				})
			) {
				Prs.push(pr)
			}
			await updateFile(PULL_REQUESTS_FILE, {
				pullRequests: Prs,
			})
			await updateFile(DATES_FILE, {
				pull_requests: lastSearched.toISOString(),
			})
		}
	}
}

{
	// Create a list of all repositories contributed to
	const repositories = []
	const prs =
		JSON.parse(await fs.readFile(PULL_REQUESTS_FILE, 'utf-8')).pullRequests ?? []
	for (const pr of prs) {
		const { owner, repoName } = getURLData(pr.html_url)
		const repo = `${owner}/${repoName}`
		if (!repositories.includes(repo) && !isExcludedRepository(repo)) {
			repositories.push(repo)
		}
	}
	await updateFile(REPOSITORIES_FILE, {
		repositories,
	})
}

{
	// Get all commits  for given repositories
	const repositories =
		JSON.parse(await fs.readFile(REPOSITORIES_FILE, 'utf-8')).repositories ?? []
	for (const repository of repositories) {
		const Commits =
			JSON.parse(await fs.readFile(COMMITS_FILE, 'utf-8'))?.commits?.[repository] ?? []
		const datesJson = JSON.parse(await fs.readFile(DATES_FILE, 'utf-8'))
		let createdAt = ''
		if (datesJson?.commits?.[repository]) {
			createdAt = `created:>${datesJson.commits[repository]}`
		}

		const iterator = octokit.paginate.iterator(octokit.rest.search.commits, {
			q: `author:${config.owner} repo:${repository} ${createdAt}`,
			sort: 'created',
			order: 'asc',
		})
		for await (const { data: commits } of iterator) {
			for (const commit of commits) {
				const { owner, repoName } = getURLData(commit.html_url)
				const createdAt = new Date(commit.commit.committer.date)
				const millisecondsInADay = 24 * 60 * 60 * 1000
				const lastSearched = new Date(createdAt - millisecondsInADay)
				const link = ansiEscapes.link(
					`${owner}/${repoName}/${commit.commit.tree.sha}`,
					commit.html_url,
				)
				console.log(`Processing ${createdAt.toISOString()} (${link})`)

				if (
					!Commits.some((item) => {
						return item.node_id === commit.node_id
					})
				) {
					Commits.push(commit)
				}
				await updateFile(COMMITS_FILE, {
					commits: {
						[repository]: Commits,
					},
				})
				await updateFile(DATES_FILE, {
					commits: {
						[repository]: lastSearched.toISOString(),
					},
				})
			}
		}
	}
}

{
	// Write 'contributions.md
	const prs =
		JSON.parse(await fs.readFile(PULL_REQUESTS_FILE, 'utf-8')).pullRequests ?? []
	const repositories =
		JSON.parse(await fs.readFile(REPOSITORIES_FILE, 'utf-8')).repositories ?? []

	const repositoryInfo = []
	for (const repo of repositories) {
		const [owner, repoName] = repo.split('/')
		const totalPrs =
			prs.filter((item) => {
				const itemData = getURLData(item.html_url)

				return (
					itemData.owner === owner &&
					itemData.repoName === repoName &&
					item.pull_request.merged_at
				)
			})?.length ?? null
		const totalCommits =
			JSON.parse(await fs.readFile(COMMITS_FILE, 'utf-8')).commits?.[repo]?.length ?? null

		if (totalPrs > 0 || totalCommits > 0) {
			repositoryInfo.push({
				repo,
				totalPrs,
				totalCommits,
			})
		}
	}

	repositoryInfo.sort((a, b) => {
		return a.totalPrs > b.totalPrs ? -1 : 1
	})

	let readmeStr = `# Contributions\n
This list is automatically generated. It is ordered by number of pull requests.\n\n`
	for (const { repo, totalPrs, totalCommits } of repositoryInfo) {
		let prPart = ''
		if (totalPrs) {
			prPart = `${totalPrs} [${
				totalPrs === 1 ? 'pull request' : 'pull requests'
			}](https://github.com/${repo}/pulls?q=author%3A${
				config.owner
			}+is%3Apr+is%3Amerged+sort%3Aupdated-desc)`
		}

		let commitPart = ''
		if (totalCommits) {
			if (totalPrs > 0) {
				commitPart += ', '
			}
			commitPart += `${totalCommits} [${
				totalCommits === 1 ? 'commit' : 'commits'
			}](https://github.com/${repo}/commits?author=${config.owner})`
		}
		readmeStr += `- [${repo}](https://github.com/${repo}) (${prPart}${commitPart})\n`
	}

	await fs.writeFile(CONTRIBUTIONS_FILE, readmeStr)
}
