const paginateRequest = require('./helpers').paginateRequest;
const hostname = require('os').hostname;
const crypto = require('crypto');

// An async fnction that returns a promise that resolves once there is at least one call left in the
// token rate limit.
async function didNotGoOverRateLimit(debug, checkRateLimit) {
  // Verify that we have api calls available to process items
  if (checkRateLimit) {
    while (true) {
      const rateLimit = await checkRateLimit();
      if (rateLimit === 0) {
        debug('Waiting for token rate limit to reset...');
        await (new Promise(resolve => setTimeout(resolve, 1000)));
      } else {
        debug('Token rate limit not exhausted - rate limit at', rateLimit);
        break;
      }
    }
  }
}

const OK = 'OK',
      RUNNING = 'RUNNING',
      ERROR = 'ERROR';

async function processFromQueue(
  link,
  user,
  debug,
  getForksForRepo,
  createPullRequest,
  didRepoOptOut,
  githubPullRequestsCreate,
  nodegit,
  tmp,
  addBackstrokeBotAsCollaborator,
  forkRepository,
  throttleBatch=0,
  checkRateLimit=false
) {
  // Provide a mechanism to throttle queue operations so that rate limits won't expire.
  if (throttleBatch > 0) {
    await (new Promise(resolve => setTimeout(resolve, throttleBatch)));
  }

  // if disabled, or upstream/fork is null, return so
  if (!link.enabled) {
    throw new Error('Link is not enabled.');
  } else if (!link.upstreamType || !link.forkType) {
    throw new Error('Please define both an upstream and fork on this link.');
  }

  // Step 1: What kind of operation are we performing?
  switch (link.forkType) {

  // Sync changes from one repository to another in-network repository.
  case 'repo': {
    debug('Webhook is on the fork. Making a pull request to the single fork repository.');

    // Ensure we didn't go over the token rate limit prior to making the pull request.
    await didNotGoOverRateLimit(debug, checkRateLimit);

    const response = await createPullRequest(
      user,
      link,
      { // Upstream
        owner: link.upstreamOwner,
        repo: link.upstreamRepo,
        branch: link.upstreamBranch,
      },
      { // Fork
        owner: link.forkOwner,
        repo: link.forkRepo,
        branch: link.upstreamBranch, // same branch as the upstream. TODO: make this configurable.
      },
      debug,
      didRepoOptOut,
      githubPullRequestsCreate
    );

    return {
      isEnabled: true,
      many: false,
      forkCount: 1, // just one repo
      response,
    };
  };

  // Sync changes to all forks of the given repository
  case 'fork-all': {
    debug('Webhook is on the upstream. Aggregating all forks...');
    // Aggregate all forks of the upstream.
    const forks = await paginateRequest(getForksForRepo, [user, {
      owner: link.upstreamOwner,
      repo: link.upstreamRepo,
    }]);

    debug(`Found ${forks.length} forks of the upstream.`);
    const all = forks.map(async fork => {
      // Ensure we didn't go over the token rate limit prior to making the pull request.
      await didNotGoOverRateLimit(debug, checkRateLimit);

      try {
        const data = await createPullRequest(
          user,
          link,
          { // Upstream
            owner: link.upstreamOwner,
            repo: link.upstreamRepo,
            branch: link.upstreamBranch,
          },
          { // Fork
            owner: fork.owner.login,
            repo: fork.name,
            branch: link.forkBranch,
          },
          debug,
          didRepoOptOut,
          githubPullRequestsCreate
        );
        return {status: 'OK', data};
      } catch (error) {
        return {status: 'ERROR', error: error.message};
      }
    });

    const data = await Promise.all(all);
    return {
      many: true,
      metrics: {
        total: data.length,
        successes: data.filter(i => i.status === 'OK').length,
      },
      errors: data.filter(i => i.status === 'ERROR'),
      isEnabled: true,
    };
  };

  // Sync changes from one repository that is out-of-network. This requires more work and more api
  // calls, so it's a different option.
  case 'unrelated-repo': {
    // Define the intermediate repository details.
    const tempForkOwner = process.env.GITHUB_BOT_USERNAME || 'backstroke-bot';
    const tempForkRepo = link.forkRepo;
    const tempForkBranch = link.forkOwner; /* Name the branch after the user the fork is under */

    // Backstroke-bot forks our fork into the intermediate fork. If the fork already exists, this is
    // a noop.
    debug(`Forking ${link.forkOwner}/${link.forkRepo} to ${tempForkOwner}/${tempForkRepo}`);
    await forkRepository(link.forkOwner, link.forkRepo);

    // Clone down the upstream
    // user/upstream@master => local
    const tempForkDirectory = await tmp.dir({unsafeCleanup: true});
    debug(`Cloning ${link.upstreamOwner}/${link.upstreamRepo} into local path ${tempForkDirectory.path}`);
    const tempFork = await nodegit.Clone(
      `https://github.com/${link.upstreamOwner}/${link.upstreamRepo}`,
      tempForkDirectory.path,
      {
        fetchOpts: {
          callbacks: {
            certificateCheck: function() { return 1; },
            credentials: function(url, userName) {
              return NodeGit.Cred.userpassPlaintextNew(process.env.GITHUB_TOKEN, "x-oauth-basic");
            },
          },
        },
      }
    );

    // Force push the upstream to the temp fork
    // local => backstroke-bot/fork@user
    debug(`Pushing local path ${tempForkDirectory.path} to ${tempForkOwner}/${tempForkRepo}@${tempForkBranch}`);
    const tempForkRemote = await nodegit.Remote.createAnonymous(
      tempFork,
      `https://github.com/${tempForkOwner}/${tempForkRepo}`
    );
    const pushError = await tempForkRemote.push([
      `+HEAD:refs/heads/${tempForkBranch}`, /* The `+` prefix means a force push, fwiw */
    ], {
      callbacks: {
        credentials(url, userName) {
          return nodegit.Cred.userpassPlaintextNew(process.env.GITHUB_TOKEN, "x-oauth-basic");
        },
      },
    });

    // Ensure pushing didn't return an error.
    if (pushError) {
      throw new Error(`Error received while pushing ${tempForkOwner}/${tempForkBranch}: ${pushError}`);
    }

    // Remove temp fork from disk
    tempForkDirectory.cleanup();
    debug(`Cleaned up ${tempForkDirectory.path}`);

    // At this point, the temporary fork mirrors the upstream, but since the temporary fork is
    // related to the actual fork, create a pull request using it instead of the upstream.
    // backstroke-bot/fork@user =PR=> user/fork@master
    const response = await createPullRequest(
      user,
      link,
      { // Upstream
        owner: tempForkOwner,
        repo: tempForkRepo,
        branch: tempForkBranch,
      },
      { // Fork
        owner: link.forkOwner,
        repo: link.forkRepo,
        branch: link.forkBranch,
      },
      debug,
      didRepoOptOut,
      githubPullRequestsCreate
    );

    return {
      isEnabled: true,
      many: false,
      unrelatedForks: true,
      forkCount: 1, // just one repo
      response,
    };
  };

  // None of those types passed? Bail.
  default:
    throw new Error(`No such 'fork' type: ${link.forkType}`);
  };
}


// The batch processing function. Eats off the queue and publishes results to redis.
module.exports = async function processBatch(
  WebhookQueue,
  WebhookStatusStore,
  debug,
  getForksForRepo,
  createPullRequest,
  didRepoOptOut,
  githubPullRequestsCreate,
  nodegit,
  tmp,
  addBackstrokeBotAsCollaborator,
  forkRepository,
  throttleBatch=0,
  checkRateLimit=false
) {
  while (true) {
    // Ensure we didn't go over the token rate limit prior to handling another link.
    await didNotGoOverRateLimit(debug, checkRateLimit);

    // Fetch a new webhook event.
    const webhook = await WebhookQueue.pop();
    // The queue is empty? Cool, we're done.
    if (!webhook) { break; }

    // Let redis know that we are starting to process this webhook.
    const startedAt = (new Date()).toISOString();
    await WebhookStatusStore.set(webhook.id, {
      status: RUNNING,
      startedAt,
    });

    // Extract a number of helpful values for use in the below code.
    const link = webhook.data.link;
    const user = webhook.data.user;

    // Log the type of update that is happening.
    process.env.NODE_ENV !== 'test' && console.log(`=> * Handling webhook ${webhook.id}:`);
    debug(`From: ${link.upstreamOwner}/${link.upstreamRepo}@${link.upstreamBranch}`);
    if (link.forkType === 'fork-all') {
      debug(`To: all forks @ ${link.upstreamBranch} (uses upstream branch)`);
    } else {
      debug(`To: ${link.forkOwner}/${link.forkRepo}@${link.forkBranch}`);
    }

    // Perform the action.
    try {
      const output = await processFromQueue(
        link,
        user,
        debug,
        getForksForRepo,
        createPullRequest,
        didRepoOptOut,
        githubPullRequestsCreate,
        nodegit,
        tmp,
        addBackstrokeBotAsCollaborator,
        forkRepository,
        throttleBatch,
        checkRateLimit
      );
      debug('Result:', output);

      // Successful! Update redis to say so.
      await WebhookStatusStore.set(webhook.id, {
        status: OK,
        startedAt,
        finishedAt: (new Date()).toISOString(),
        output,
        link,
        handledBy: crypto.createHash('sha256').update(hostname()).digest('base64'),
      });
    } catch (error) {
      // Error! Update redis to say so.
      await WebhookStatusStore.set(webhook.id, {
        status: ERROR,
        startedAt,
        finishedAt: (new Date()).toISOString(),
        output: {error: error.message, stack: error.stack},
        link: Object.assign({}, link, {user: undefined}),
      });
    }
  }
}
