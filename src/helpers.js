const GitHubApi = require('github');

// Given a method and arguments, issue a request until all possible data items come through.
function paginateRequest(method, args, pageSize=100, page=0, cumulativeData=[]) {
  // Add a page size to the request.
  if (!Array.isArray(args)) {
    args = [args];
  }
  args[0].page = page;
  args[0].per_page = pageSize;

  return method.apply(null, args).then(data => {
    if (data.length === pageSize) {
      // Data is still coming, go for another round.
      cumulativeData = [...cumulativeData, ...data];
      return paginateRequest(method, args, pageSize, ++page, cumulativeData);
    } else if (data.length < pageSize) {
      // Fewer resuts returned than expected, so we know this is the last page.
      cumulativeData = [...cumulativeData, ...data];
      return cumulativeData;
    } else {
      // NOTE: this case should never happen, where more results are returned then expected.
      return cumulativeData;
    }
  });
}

function getForksForRepo(user, args) {
  const github = new GitHubApi({timeout: 5000});
  github.authenticate({type: "oauth", token: user.accessToken});

  return new Promise((resolve, reject) => {
    github.repos.getForks(args, (err, res) => {
      if (err) {
        reject(new Error(`Couldn't get forks for repository ${args.owner}/${args.repo}: ${err.message ? err.message : err}`));
      } else {
        resolve(res.data);
      }
    });
  });
}

// Return the smallest number of api calls required to exhaust the rate limit.
function checkRateLimit() {
  const github = new GitHubApi({timeout: 5000});
  github.authenticate({type: "oauth", token: process.env.GITHUB_TOKEN});

  return new Promise((resolve, reject) => {
    github.misc.getRateLimit({}, (err, res) => {
      if (err) {
        reject(new Error(`Couldn't fetch token rate limit: ${err.message ? err.message : err}`));
      } else {
        resolve(res.data.resources.core.remaining);
      }
    });
  });
}

// Given a repository `user/repo` and a provider that the repo is located on (ex: `github`),
// determine if the repo opted out.
function didRepoOptOut(github, user, owner, repo) {
  return new Promise((resolve, reject) => {
    // Use the link owner's token when making the request
    github.authenticate({type: "oauth", token: user.accessToken});

    // Make request.
    github.issues.getForRepo({
      owner, repo,
      labels: 'optout',
      per_page: 1,
    }, (err, issues) => {
      if (err && err.errors && err.errors.find(i => i.code === 'invalid')) {
        reject(new Error(`Repository ${owner}/${repo} doesn't exist.`));
      } else if (err) {
        reject(new Error(`Couldn't search issues on repository ${owner}/${repo}: ${err.message ? err.message : err}`));
      } else {
        resolve(issues.data.length > 0);
      }
    });
  });
}

// Add the backstroke bot user as a collaorabor on the given repository.
async function addBackstrokeBotAsCollaborator(github, owner, repo) {
  return new Promise((resolve, reject) => {
    const github = new GitHubApi({timeout: 5000});

    // Use the link owner's token when making the request
    github.authenticate({type: "oauth", token: user.accessToken});

    // Make request.
    const username = process.env.GITHUB_BOT_USERNAME || 'backstroke-bot';
    github.repos.addCollaborator({
      owner,
      repo,
      username,
      permission: 'pull',
    }, err => {
      if (err && err.errors && err.errors.find(i => i.code === 'invalid')) {
        reject(new Error(`Repository ${owner}/${repo} doesn't exist.`));
      } else if (err) {
        reject(new Error(`Couldn't make the ${username} bot user a collaborator on ${owner}/${repo}: ${err.message ? err.message : err}`));
      } else {
        resolve();
      }
    });
  });
}

// Fork a repository on github into the backstroke-bot user account.
async function forkRepository(owner, repo) {
  return new Promise((resolve, reject) => {
    const github = new GitHubApi({timeout: 5000});

    // Use the link owner's token when making the request
    github.authenticate({type: "oauth", token: process.env.GITHUB_TOKEN});

    // Make request.
    const username = process.env.GITHUB_BOT_USERNAME || 'backstroke-bot';
    github.repos.fork({
      owner,
      repo,
    }, err => {
      if (err) {
        reject(new Error(`Couldn't fork ${owner}/${repo} to ${username}/${repo}: ${err.message ? err.message : err}`));
      } else {
        resolve();
      }
    });
  });
}

const generatePullRequestTitle = (user, repo, branch) => `Update from upstream repo ${user}/${repo}@${branch}`;
const generatePullRequestBody = link => {
  switch (link.forkType) {
    case 'fork-all':
    case 'repo':
      return `Hello!\n
The upstream repository \`${link.upstreamOwner}/${link.upstreamRepo}@${link.upstreamBranch}\` has \\
some new changes that aren't in this fork. So, here they are, ready to be merged! :tada:

If this pull request can be merged without conflict, you can publish your software \\
with these new changes. Otherwise, fix any merge conflicts by clicking the \`Resolve Conflicts\` \\
button.

--------
<img
  src="https://backstroke.co/assets/img/donate.png"
  height="92"
  align="left"
/>

If you like Backstroke, consider chipping in to help pay the server bill \\
<a href="https://gratipay.com/Backstroke/">here</a>. Backstroke is a completely open source \\
project that's free to use, but we survive on sponsorships and donations. Thanks for your \\
support! <a href="https://gratipay.com/Backstroke/">Help out Backstroke</a>.

--------
Created by [Backstroke](https://backstroke.co) (I'm a bot!)
`.replace(/\\\n/g, '');

    case 'unrelated-repo':
      return `Hello!\n
The upstream repository \`${link.upstreamOwner}/${link.upstreamRepo}@${link.upstreamBranch}\` has \\
some new changes that aren't in this repository. So, here they are, ready to be merged! :tada:

Since this repository isn't related to the upstream, I've copied the contents of the \\
upstream repository into the \`${link.upstreamOwner}\` branch within a [temporary \\
repository](https://github.com/${process.env.GITHUB_BOT_USERNAME || 'backstroke-bot'}/${link.forkRepo}/tree/${link.upstreamOwner}) \\
to make syncing an out-of-network upstream possible - [Read more](http://bit.ly/backstroke-out-of-network).

If this pull request can be merged without conflict, you can publish your software\\
with these new changes. Otherwise, fix any merge conflicts by clicking the \`Resolve Conflicts\`\\
button.

--------
<img
  src="https://backstroke.co/assets/img/donate.png"
  height="92"
  align="left"
/>

If you like Backstroke, consider chipping in to help pay the server bill \\
<a href="https://gratipay.com/Backstroke/">here</a>. Backstroke is a completely open source \\
project that's free to use, but we survive on sponsorships and donations. Thanks for your \\
support! <a href="https://gratipay.com/Backstroke/">Help out Backstroke</a>.

--------
Created by [Backstroke](https://backstroke.co) (I'm a bot!)
`.replace(/\\\n/g, '');
  }
};


async function createPullRequest(user, link, upstream, fork, debug, didRepoOptOut, githubPullRequestsCreate) {
  const github = new GitHubApi({timeout: 5000});
  if (!process.env.GITHUB_TOKEN) {
    if (process.env.NODE_ENV !== 'test') {
      debug('No GITHUB_TOKEN was set - please set the machine user token env variable.');
      return Promise.reject('Set GITHUB_TOKEN env variable.');
    }
  } else {
    // Authorize access to the github api.
    github.authenticate({type: "oauth", token: process.env.GITHUB_TOKEN});
  }

  const didOptOut = await didRepoOptOut(github, user, fork.owner, fork.repo);

  // Do we have permission to make a pull request on the child?
  if (didOptOut) {
    debug(`Repo opted out of pull requests: ${fork.owner}/${fork.repo}`);
    throw new Error('This repo opted out of backstroke pull requests');
  } else {
    // Add backstroke bot user as a collaborator if the repository is private.
    if (fork.private) {
      const username = process.env.GITHUB_BOT_USERNAME || 'backstroke-bot';
      debug(`Fork ${fork.owner}/${fork.repo} is private, adding ${username} as a collaborator before proposing changes...`);
      await addBackstrokeBotAsCollaborator(github, fork.owner, fork.repo);
    }

    // Create a new pull request from the upstream to the child.
    return new Promise((resolve, reject) => {
      return githubPullRequestsCreate(github)({
        owner: fork.owner,
        repo: fork.repo,
        title: generatePullRequestTitle(link.upstreamOwner, link.upstreamRepo, link.upstreamBranch),
        head: `${upstream.owner}:${upstream.branch}`,
        base: link.forkType === 'fork-all' ? upstream.branch : fork.branch,
        body: generatePullRequestBody(link),
        maintainer_can_modify: false,
      }, err => {
        if (err && err.code === 422) {
          // The pull request already existed
          debug(`Already a pull request on ${fork.owner}/${fork.repo} from ${link.upstreamOwner}/${link.upstreamRepo}`);
          resolve(`There's already a pull request on ${link.forkOwner}/${link.forkRepo}`);
        } else if (err) {
          // Still reject anything else
          reject(new Error(`Couldn't create pull request on repository ${fork.owner}/${fork.repo}: ${err.message ? err.message : err}`));
        } else {
          resolve(`Successfully created pull request on ${fork.owner}/${fork.repo}`);
        }
      });
    });
  }
}

module.exports = {
  paginateRequest,
  getForksForRepo,
  createPullRequest,
  didRepoOptOut,
  checkRateLimit,
  forkRepository,
  addBackstrokeBotAsCollaborator,
};
