const OK = 'OK',
      RUNNING = 'RUNNING',
      ERROR = 'ERROR';

async function process(
  link,
  user,
  debug,
  getForksForRepo,
  createPullRequest,
  didRepoOptOut,
  githubPullRequestsCreate
) {
  // if disabled, or upstream/fork is null, return so
  if (!link.enabled) {
    throw new Error('Link is not enabled.');
  } else if (!link.upstreamType || !link.forkType) {
    throw new Error('Please define both an upstream and fork on this link.');
  }

  // Step 1: are we dealing with a repo to merge into or all the forks of a repo?
  if (link.forkType === 'repo') {
    debug('Webhook is on the fork. Making a pull request to the single fork repository.');
    const response = await createPullRequest(
      user,
      link,
      {
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
  } else if (link.forkType === 'fork-all') {
    debug('Webhook is on the upstream. Aggregating all forks...');
    // Aggregate all forks of the upstream.
    const forks = await paginateRequest(getForksForRepo, [user, {
      owner: link.upstreamOwner,
      repo: link.upstreamRepo,
    }]);

    debug('Found %d forks of the upstream.', forks.length);
    const all = forks.map(async fork => {
      return createPullRequest(
        user,
        link,
        {
          owner: fork.owner.login,
          repo: fork.name,
          branch: link.forkBranch,
        },
        debug,
        didRepoOptOut,
        githubPullRequestsCreate
      );
    });

    const data = await Promise.all(all);
    return {
      many: true,
      forkCount: data.length, // total amount of forks handled
      isEnabled: true,
    };
  } else {
    throw new Error(`No such 'fork' type: ${link.forkType}`);
  }
}


// The batch processing function. Eats off the queue and publishes results to redis.
module.exports = async function processBatch(
  WebhookQueue,
  WebhookStatusStore,
  debug,
  getForksForRepo,
  createPullRequest,
  didRepoOptOut,
  githubPullRequestsCreate
) {
  while (true) {
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
    console.log(`=> * Handling webhook ${webhook.id}:`);
    debug(`From: ${link.upstreamOwner}/${link.upstreamRepo}@${link.upstreamBranch}`);
    if (link.forkType === 'fork-all') {
      debug(`To: all forks @ ${link.upstreamBranch} (uses upstream branch)`);
    } else {
      debug(`To: ${link.forkOwner}/${link.forkRepo}@${link.forkBranch}`);
    }

    // Perform the action.
    try {
      const output = await process(
        link,
        user,
        debug,
        getForksForRepo,
        createPullRequest,
        didRepoOptOut,
        githubPullRequestsCreate
      );
      debug('Result:', output);

      // Successful! Update redis to say so.
      await WebhookStatusStore.set(webhook.id, {
        status: OK,
        startedAt,
        finishedAt: (new Date()).toISOString(),
        output,
      });
    } catch (error) {
      // Error! Update redis to say so.
      await WebhookStatusStore.set(webhook.id, {
        status: ERROR,
        startedAt,
        finishedAt: (new Date()).toISOString(),
        output: {error},
      });
    }
  }
}
