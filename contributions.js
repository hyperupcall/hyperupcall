import * as fs from 'node:fs/promises'
import path from 'node:path'
import { Octokit, App } from 'octokit'

const octokit = new Octokit({ auth: process.env.GITHUB_AUTH_TOKEN })
const DATES_FILE = './data/dates.json'
const PULL_REQUESTS_FILE = './data/pull_requests.json'
const CONTRIBUTIONS_FILE = './contributions.md'

// Create files
{
	for (const file of [DATES_FILE, PULL_REQUESTS_FILE]) {
		try {
			await fs.readFile(file, 'utf-8')
		} catch {
			await fs.mkdir(path.dirname(file), { recursive: true })
			await fs.writeFile(file, '{}\n')
		}
	}
}

/**
 * @param {string} file
 * @param {Record<PropertyKey, unknown>} json
 */
async function updateFile(file, newJson) {
	const oldJson = JSON.parse(await fs.readFile(file, 'utf-8'))
	const json = {
		...oldJson,
		...newJson,
	}
	await fs.writeFile(file, JSON.stringify(json, null, '\t'))
}

/**
 * @param {string} html_url
 * @returns {{ owner: string, repo: string, number: number }}
 */
function getURLData(html_url) {
	const match = html_url.match(/^https:\/\/github\.com\/(?<owner>.*?)\/(?<repo>.*?)\//u)
	const owner = match.groups?.['owner']
	const repo = match.groups?.['repo']

	return {
		owner,
		repo,
	}
}

{
	const pullRequests =
		JSON.parse(await fs.readFile(PULL_REQUESTS_FILE, 'utf-8')).pullRequests ?? []

	// Get all pull requests for owner
	const owner = 'hyperupcall'
	const createdAt = await (async () => {
		const datesJson = JSON.parse(await fs.readFile(DATES_FILE, 'utf-8'))
		if (datesJson?.pulls?.lastSearchedCreatedAt) {
			return `created:>${datesJson.pulls.lastSearchedCreatedAt}`
		} else {
			return ''
		}
	})()

	const iterator = octokit.paginate.iterator(octokit.rest.search.issuesAndPullRequests, {
		q: `is:pr author:${owner} ${createdAt}`,
		sort: 'created',
		order: 'asc',
	})
	for await (const { data: prs } of iterator) {
		for (const pr of prs) {
			const { owner, repo } = getURLData(pr.html_url)
			const createdAtDate = new Date(pr.created_at)
			const millisecondsInADay = 24 * 60 * 60 * 1000
			const lastSearchedCreatedAt = new Date(createdAtDate - millisecondsInADay)

			console.log(`Processing ${pr.created_at} (${owner}/${repo}/pulls/${pr.number})`)
			if (
				!pullRequests.some((item) => {
					return item.node_id === pr.node_id
				})
			) {
				pullRequests.push(pr)
			}
			await updateFile(PULL_REQUESTS_FILE, {
				pullRequests,
			})
			await updateFile(DATES_FILE, {
				pulls: {
					lastSearchedCreatedAt: lastSearchedCreatedAt.toISOString(),
				},
			})
		}
	}
}

// TODO: commits
// {
// 	const commits = []

// 	// Get all pull requests for owner
// 	const owner = 'hyperupcall'
// 	const createdAt = await (async () => {
// 		const datesJson = await getDatesJsonFile()
// 		if (datesJson?.commits?.lastSearchedCreatedAt) {
// 			return `created:>${datesJson.commits.lastSearchedCreatedAt}`
// 		} else {
// 			return ''
// 		}
// 	})()
// 	console.log(createdAt)
// 	const iterator = octokit.paginate.iterator(octokit.rest.search.commits, {
// 		q: `is:commit author:${owner}`,
// 		sort: 'created',
// 		order: 'asc'
// 	})
// 	for await (const { data: commits } of iterator) {
// 		for (const commit of commits) {
// 			const { owner, repo, number } = getURLData(pr.html_url)
// 			const createdAtDate = new Date(commit.commit.committer.date)
// 			const millisecondsInADay = 24 * 60 * 60 * 1000
// 			const lastSearchedCreatedAt = new Date(createdAtDate - millisecondsInADay)

// 			console.log(`Processing ${commit.created_at} (${owner}/${repo} #${number})`);
// 			if (!commits.some((item) => {
// 				item.node_id === commit.node_id
// 			})) {
// 				commits.push(commit)
// 			}
// 			await updateDataJsonFile({
// 				commits: commits
// 			})
// 			await updateDatesJsonFile({
// 				commits: {
// 					lastSearchedCreatedAt: lastSearchedCreatedAt.toISOString()
// 				}
// 			})
// 		}
// 	}
// 	await fs.writeFile('./commits.json', JSON.stringify(commits, null, '\t'))
// }

{
	// Write 'contributions.md
	const contributions = new Map()
	const prs = JSON.parse(await fs.readFile(PULL_REQUESTS_FILE, 'utf-8')).pullRequests ?? []
	for (const pr of prs) {
		const { owner, repo } = getURLData(pr.html_url)

		if (!pr.pull_request.merged_at) {
			continue
		}
		const key = `${owner}/${repo}`
		if (contributions.has(key)) {
			contributions.set(key, {
				count: (contributions.get(key)).count + 1,
				list: [...(contributions.get(key).list), pr]
			})
		} else {
			contributions.set(key, {
				count: 1,
				list: [pr]
			})
		}
	}
	let contributionsObj = Array.from(contributions)
	contributionsObj.sort(([key1, value1], [key2, value2]) => {
		return value1.count >= value2.count ? -1 : 0
	})

	let readmeStr = `# Contributions\n
This list is automatically generated. It is ordered by number of pull requests.\n\n`
	const owner = 'hyperupcall'
	outer: for (const [repo, prs] of contributionsObj) {
		for (const nots of [
			'JasperNelson',
			'orangeyiestfruit',
			'fox-',
			'rapidotapp',
			'ecc-cs-club',
			'bash-bastion',
		]) {
			if (repo.includes(nots)) {
				continue outer
			}
		}

		readmeStr += `- ${prs.count} contributions to [${repo}](https://github.com/${repo}) ([pull requests](https://github.com/${repo}/pulls?q=author%3A${owner}+is%3Apr+is%3Amerged+sort%3Aupdated-desc), [commits](https://github.com/${repo}/commits?author=${owner}))\n`
	}

	await fs.writeFile(CONTRIBUTIONS_FILE, readmeStr)
}
