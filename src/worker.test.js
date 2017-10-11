const sinon = require('sinon');
const assert = require('assert');

const processBatch = require('./worker');

const MockWebhookQueue = {
  queue: [],
  reset() {
    this.queue = [];
  },
  push(data) {
    const id = (new Date()).getTime();
    this.queue.push({id, data});
    return Promise.resolve(id);
  },
  pop() {
    const popped = this.queue.pop();
    return Promise.resolve(popped ? popped : null);
  },
};

const MockWebhookStatusStore = {
  keys: {},
  set(webhookId, status) {
    const id = (new Date()).getTime();
    this.keys[webhookId] = {status, id};
    return Promise.resolve(id);
  },
  get(webhookId) {
    return Promise.resolve(this.keys[webhookId].status);
  },
};

describe('webhook worker', () => {
  it('should create a pull request when given a single fork', async () => {
    const createPullRequest = require('./helpers').createPullRequest;
    const getForksForRepo = sinon.stub().resolves([{
      owner: {login: 'foo'},
      name: 'bar',
    }]);
    const didRepoOptOut = sinon.stub().resolves(false);
    const githubPullRequestsCreate = () => sinon.stub().yields(null);

    const enqueuedAs = await MockWebhookQueue.push({
      type: 'MANUAL',
      user: {
        id: 1,
        username: '1egoman',
        email: null,
        githubId: '1704236',
        accessToken: 'ACCESS TOKEN',
        publicScope: false,
        createdAt: '2017-08-09T12:00:36.000Z',
        lastLoggedInAt: '2017-08-16T12:50:40.203Z',
        updatedAt: '2017-08-16T12:50:40.204Z',
      },
      link: {
        id: 8,
        name: 'My Link',
        enabled: true,
        webhookId: '37948270678a440a97db01ebe71ddda2',
        lastSyncedAt: '2017-08-17T11:37:22.999Z',
        upstreamType: 'repo',
        upstreamOwner: '1egoman',
        upstreamRepo: 'backstroke',
        upstreamIsFork: null,
        upstreamBranches: '["inject","master"]',
        upstreamBranch: 'master',
        forkType: 'repo',
        forkOwner: 'rgaus',
        forkRepo: 'backstroke',
        forkBranches: '["master"]',
        forkBranch: 'master',
        createdAt: '2017-08-11T10:17:09.614Z',
        updatedAt: '2017-08-17T11:37:23.001Z',
        ownerId: 1,
        owner: {
          id: 1,
          username: '1egoman',
          email: null,
          githubId: '1704236',
          accessToken: 'ACCESS TOKEN',
          publicScope: false,
          createdAt: '2017-08-09T12:00:36.000Z',
          lastLoggedInAt: '2017-08-16T12:50:40.203Z',
          updatedAt: '2017-08-16T12:50:40.204Z',
        }
      },
    });

    // Run the worker that eats off the queue.
    await processBatch(
      MockWebhookQueue,
      MockWebhookStatusStore,
      () => null, //console.log.bind(console, '* '),
      getForksForRepo,
      createPullRequest,
      didRepoOptOut,
      githubPullRequestsCreate
    );

    // Make sure that it worked
    const response = MockWebhookStatusStore.keys[enqueuedAs].status;
    assert.equal(response.status, 'OK');
    assert.deepEqual(response.output, {
      isEnabled: true,
      many: false,
      forkCount: 1,
      response: 'Successfully created pull request on rgaus/backstroke',
    });
  });
  it('should create a pull request on each fork when given a bunch of forks', async () => {
    const createPullRequest = require('./helpers').createPullRequest;
    const getForksForRepo = sinon.stub().resolves([
      {owner: {login: 'hello'}, name: 'world'},
      {owner: {login: 'another'}, name: 'repo'},
    ]);
    const didRepoOptOut = sinon.stub().resolves(false);

    const pullRequestMock = sinon.stub().yields(null);
    const githubPullRequestsCreate = () => pullRequestMock;

    const enqueuedAs = await MockWebhookQueue.push({
      type: 'MANUAL',
      user: {
        id: 1,
        username: '1egoman',
        email: null,
        githubId: '1704236',
        accessToken: 'ACCESS TOKEN',
        publicScope: false,
        createdAt: '2017-08-09T12:00:36.000Z',
        lastLoggedInAt: '2017-08-16T12:50:40.203Z',
        updatedAt: '2017-08-16T12:50:40.204Z',
      },
      link: {
        id: 8,
        name: 'foo',
        enabled: true,
        webhookId: '37948270678a440a97db01ebe71ddda2',
        lastSyncedAt: '2017-08-17T11:37:22.999Z',
        upstreamType: 'repo',
        upstreamOwner: '1egoman',
        upstreamRepo: 'biome',
        upstreamIsFork: null,
        upstreamBranches: '["inject","master"]',
        upstreamBranch: 'master',
        forkType: 'fork-all',
        forkOwner: undefined,
        forkRepo: undefined,
        forkBranches: undefined,
        forkBranch: undefined,
        createdAt: '2017-08-11T10:17:09.614Z',
        updatedAt: '2017-08-17T11:37:23.001Z',
        ownerId: 1,
        owner: {
          id: 1,
          username: '1egoman',
          email: null,
          githubId: '1704236',
          accessToken: 'ACCESS TOKEN',
          publicScope: false,
          createdAt: '2017-08-09T12:00:36.000Z',
          lastLoggedInAt: '2017-08-16T12:50:40.203Z',
          updatedAt: '2017-08-16T12:50:40.204Z',
        }
      },
    });

    // Run the worker that eats off the queue.
    await processBatch(
      MockWebhookQueue,
      MockWebhookStatusStore,
      () => null, //console.log.bind(console, '* '),
      getForksForRepo,
      createPullRequest,
      didRepoOptOut,
      githubPullRequestsCreate
    );

    // Make sure that it worked
    const response = MockWebhookStatusStore.keys[enqueuedAs].status;
    assert.equal(response.status, 'OK');
    assert.deepEqual(response.output, {
      many: true,
      metrics: {total: 2, successes: 2},
      errors: [],
      isEnabled: true,
    });

    // Should have created two pull requests.
    assert.equal(pullRequestMock.callCount, 2);
  });

  it('should try to make a PR to a single fork of an upstream, but the repo opted out', async () => {
    const createPullRequest = require('./helpers').createPullRequest;
    const getForksForRepo = sinon.stub().resolves([{
      owner: {login: 'foo'},
      name: 'bar',
    }]);
    const didRepoOptOut = sinon.stub().resolves(true);

    const pullRequestMock = sinon.stub().yields(null);
    const githubPullRequestsCreate = () => pullRequestMock;

    const enqueuedAs = await MockWebhookQueue.push({
      type: 'MANUAL',
      user: {
        id: 1,
        username: '1egoman',
        email: null,
        githubId: '1704236',
        accessToken: 'ACCESS TOKEN',
        publicScope: false,
        createdAt: '2017-08-09T12:00:36.000Z',
        lastLoggedInAt: '2017-08-16T12:50:40.203Z',
        updatedAt: '2017-08-16T12:50:40.204Z',
      },
      link: {
        id: 8,
        name: 'foo',
        enabled: true,
        webhookId: '37948270678a440a97db01ebe71ddda2',
        lastSyncedAt: '2017-08-17T11:37:22.999Z',
        upstreamType: 'repo',
        upstreamOwner: '1egoman',
        upstreamRepo: 'biome',
        upstreamIsFork: null,
        upstreamBranches: '["inject","master"]',
        upstreamBranch: 'master',
        forkType: 'repo',
        forkOwner: 'rgaus',
        forkRepo: 'biome',
        forkBranches: '["master"]',
        forkBranch: 'master',
        createdAt: '2017-08-11T10:17:09.614Z',
        updatedAt: '2017-08-17T11:37:23.001Z',
        ownerId: 1,
        owner: {
          id: 1,
          username: '1egoman',
          email: null,
          githubId: '1704236',
          accessToken: 'ACCESS TOKEN',
          publicScope: false,
          createdAt: '2017-08-09T12:00:36.000Z',
          lastLoggedInAt: '2017-08-16T12:50:40.203Z',
          updatedAt: '2017-08-16T12:50:40.204Z',
        }
      },
    });

    // Run the worker that eats off the queue.
    await processBatch(
      MockWebhookQueue,
      MockWebhookStatusStore,
      () => null, //console.log.bind(console, '* '),
      getForksForRepo,
      createPullRequest,
      didRepoOptOut,
      githubPullRequestsCreate
    );

    // Make sure that it worked
    const response = MockWebhookStatusStore.keys[enqueuedAs].status;
    assert.equal(response.status, 'ERROR');
    assert.equal(response.output.error, 'This repo opted out of backstroke pull requests');
  });
  it('should try to make a PR to a single fork of an upstream, but a pull request already exists', async () => {
    const createPullRequest = require('./helpers').createPullRequest;
    const getForksForRepo = sinon.stub().resolves([{
      owner: {login: 'foo'},
      name: 'bar',
    }]);
    const didRepoOptOut = sinon.stub().resolves(false);

    const pullRequestMock = sinon.stub().yields({code: 422}); // 422 = pull request already exists
    const githubPullRequestsCreate = () => pullRequestMock;

    const enqueuedAs = await MockWebhookQueue.push({
      type: 'MANUAL',
      user: {
        id: 1,
        username: '1egoman',
        email: null,
        githubId: '1704236',
        accessToken: 'ACCESS TOKEN',
        publicScope: false,
        createdAt: '2017-08-09T12:00:36.000Z',
        lastLoggedInAt: '2017-08-16T12:50:40.203Z',
        updatedAt: '2017-08-16T12:50:40.204Z',
      },
      link: {
        id: 8,
        name: 'foo',
        enabled: true,
        webhookId: '37948270678a440a97db01ebe71ddda2',
        lastSyncedAt: '2017-08-17T11:37:22.999Z',
        upstreamType: 'repo',
        upstreamOwner: '1egoman',
        upstreamRepo: 'biome',
        upstreamIsFork: null,
        upstreamBranches: '["inject","master"]',
        upstreamBranch: 'master',
        forkType: 'repo',
        forkOwner: 'rgaus',
        forkRepo: 'biome',
        forkBranches: '["master"]',
        forkBranch: 'master',
        createdAt: '2017-08-11T10:17:09.614Z',
        updatedAt: '2017-08-17T11:37:23.001Z',
        ownerId: 1,
        owner: {
          id: 1,
          username: '1egoman',
          email: null,
          githubId: '1704236',
          accessToken: 'ACCESS TOKEN',
          publicScope: false,
          createdAt: '2017-08-09T12:00:36.000Z',
          lastLoggedInAt: '2017-08-16T12:50:40.203Z',
          updatedAt: '2017-08-16T12:50:40.204Z',
        }
      },
    });

    // Run the worker that eats off the queue.
    await processBatch(
      MockWebhookQueue,
      MockWebhookStatusStore,
      () => null, //console.log.bind(console, '* '),
      getForksForRepo,
      createPullRequest,
      didRepoOptOut,
      githubPullRequestsCreate
    );

    // Make sure that it worked
    const response = MockWebhookStatusStore.keys[enqueuedAs].status;
    assert.equal(response.status, 'OK');
    assert.equal(response.output.response, `There's already a pull request on rgaus/biome`);
  });
  it('should try to make a PR to a single fork of an upstream, but an unknown error happens', async () => {
    const createPullRequest = require('./helpers').createPullRequest;
    const getForksForRepo = sinon.stub().resolves([{
      owner: {login: 'foo'},
      name: 'bar',
    }]);
    const didRepoOptOut = sinon.stub().resolves(false);

    const pullRequestMock = sinon.stub().yields(new Error('Unknown Error!'));
    const githubPullRequestsCreate = () => pullRequestMock;

    const enqueuedAs = await MockWebhookQueue.push({
      type: 'MANUAL',
      user: {
        id: 1,
        username: '1egoman',
        email: null,
        githubId: '1704236',
        accessToken: 'ACCESS TOKEN',
        publicScope: false,
        createdAt: '2017-08-09T12:00:36.000Z',
        lastLoggedInAt: '2017-08-16T12:50:40.203Z',
        updatedAt: '2017-08-16T12:50:40.204Z',
      },
      link: {
        id: 8,
        name: 'foo',
        enabled: true,
        webhookId: '37948270678a440a97db01ebe71ddda2',
        lastSyncedAt: '2017-08-17T11:37:22.999Z',
        upstreamType: 'repo',
        upstreamOwner: '1egoman',
        upstreamRepo: 'biome',
        upstreamIsFork: null,
        upstreamBranches: '["inject","master"]',
        upstreamBranch: 'master',
        forkType: 'repo',
        forkOwner: 'rgaus',
        forkRepo: 'biome',
        forkBranches: '["master"]',
        forkBranch: 'master',
        createdAt: '2017-08-11T10:17:09.614Z',
        updatedAt: '2017-08-17T11:37:23.001Z',
        ownerId: 1,
        owner: {
          id: 1,
          username: '1egoman',
          email: null,
          githubId: '1704236',
          accessToken: 'ACCESS TOKEN',
          publicScope: false,
          createdAt: '2017-08-09T12:00:36.000Z',
          lastLoggedInAt: '2017-08-16T12:50:40.203Z',
          updatedAt: '2017-08-16T12:50:40.204Z',
        }
      },
    });

    // Run the worker that eats off the queue.
    await processBatch(
      MockWebhookQueue,
      MockWebhookStatusStore,
      () => null, //console.log.bind(console, '* '),
      getForksForRepo,
      createPullRequest,
      didRepoOptOut,
      githubPullRequestsCreate
    );

    // Make sure that it worked
    const response = MockWebhookStatusStore.keys[enqueuedAs].status;
    assert.equal(response.status, 'ERROR');
    assert.equal(response.output.error, `Couldn't create pull request on repository rgaus/biome: Unknown Error!`);
  });
  it('should make a PR to a single fork of an upstream, but the link is disabled', async () => {
    const createPullRequest = require('./helpers').createPullRequest;
    const getForksForRepo = sinon.stub().resolves([{
      owner: {login: 'foo'},
      name: 'bar',
    }]);
    const didRepoOptOut = sinon.stub().resolves(false);

    const pullRequestMock = sinon.stub().yields(null);
    const githubPullRequestsCreate = () => pullRequestMock;

    const enqueuedAs = await MockWebhookQueue.push({
      type: 'MANUAL',
      user: {
        id: 1,
        username: '1egoman',
        email: null,
        githubId: '1704236',
        accessToken: 'ACCESS TOKEN',
        publicScope: false,
        createdAt: '2017-08-09T12:00:36.000Z',
        lastLoggedInAt: '2017-08-16T12:50:40.203Z',
        updatedAt: '2017-08-16T12:50:40.204Z',
      },
      link: {
        id: 8,
        name: 'foo',
        enabled: false,
        webhookId: '37948270678a440a97db01ebe71ddda2',
        lastSyncedAt: '2017-08-17T11:37:22.999Z',
        upstreamType: 'repo',
        upstreamOwner: '1egoman',
        upstreamRepo: 'biome',
        upstreamIsFork: null,
        upstreamBranches: '["inject","master"]',
        upstreamBranch: 'master',
        forkType: 'repo',
        forkOwner: 'rgaus',
        forkRepo: 'biome',
        forkBranches: '["master"]',
        forkBranch: 'master',
        createdAt: '2017-08-11T10:17:09.614Z',
        updatedAt: '2017-08-17T11:37:23.001Z',
        ownerId: 1,
        owner: {
          id: 1,
          username: '1egoman',
          email: null,
          githubId: '1704236',
          accessToken: 'ACCESS TOKEN',
          publicScope: false,
          createdAt: '2017-08-09T12:00:36.000Z',
          lastLoggedInAt: '2017-08-16T12:50:40.203Z',
          updatedAt: '2017-08-16T12:50:40.204Z',
        }
      },
    });

    // Run the worker that eats off the queue.
    await processBatch(
      MockWebhookQueue,
      MockWebhookStatusStore,
      () => null, //console.log.bind(console, '* '),
      getForksForRepo,
      createPullRequest,
      didRepoOptOut,
      githubPullRequestsCreate
    );

    // Make sure that it worked
    const response = MockWebhookStatusStore.keys[enqueuedAs].status;
    assert.equal(response.status, 'ERROR');
    assert.equal(response.output.error, 'Link is not enabled.');
  });
  it('should make a PR to a single fork of an upstream, but upstream / fork are null', async () => {
    const createPullRequest = sinon.stub().yields([null]);
    const getForksForRepo = sinon.stub().resolves([{
      owner: {login: 'foo'},
      name: 'bar',
    }]);
    const didRepoOptOut = sinon.stub().resolves(false);

    const enqueuedAs = await MockWebhookQueue.push({
      type: 'MANUAL',
      user: {
        id: 1,
        username: '1egoman',
        email: null,
        githubId: '1704236',
        accessToken: 'ACCESS TOKEN',
        publicScope: false,
        createdAt: '2017-08-09T12:00:36.000Z',
        lastLoggedInAt: '2017-08-16T12:50:40.203Z',
        updatedAt: '2017-08-16T12:50:40.204Z',
      },
      link: {
        id: 8,
        name: 'foo',
        enabled: true,
        webhookId: '37948270678a440a97db01ebe71ddda2',
        lastSyncedAt: '2017-08-17T11:37:22.999Z',
        upstreamType: undefined,
        upstreamOwner: undefined,
        upstreamRepo: undefined,
        upstreamIsFork: undefined,
        upstreamBranches: undefined,
        upstreamBranch: undefined,
        forkType: undefined,
        forkOwner: undefined,
        forkRepo: undefined,
        forkBranches: undefined,
        forkBranch: undefined,
        createdAt: '2017-08-11T10:17:09.614Z',
        updatedAt: '2017-08-17T11:37:23.001Z',
        ownerId: 1,
        owner: {
          id: 1,
          username: '1egoman',
          email: null,
          githubId: '1704236',
          accessToken: 'ACCESS TOKEN',
          publicScope: false,
          createdAt: '2017-08-09T12:00:36.000Z',
          lastLoggedInAt: '2017-08-16T12:50:40.203Z',
          updatedAt: '2017-08-16T12:50:40.204Z',
        }
      },
    });

    // Run the worker that eats off the queue.
    await processBatch(
      MockWebhookQueue,
      MockWebhookStatusStore,
      () => null, // console.log.bind(console, '* '),
      getForksForRepo,
      createPullRequest,
      didRepoOptOut
    );

    // Make sure that it worked
    const response = MockWebhookStatusStore.keys[enqueuedAs].status;
    assert.equal(response.status, 'ERROR');
    assert.equal(response.output.error, 'Please define both an upstream and fork on this link.');
  });
  it(`should make a PR to a single fork of an upstream, but fork is a repository that doesn't exist`, async () => {
    const createPullRequest = sinon.stub().yields([null]);
    const getForksForRepo = sinon.stub().resolves([{
      owner: {login: 'foo'},
      name: 'bar',
    }]);
    const didRepoOptOut = sinon.stub().rejects(new Error(`Repository foo/bar doesn't exist!`));

    const enqueuedAs = await MockWebhookQueue.push({
      type: 'MANUAL',
      user: {
        id: 1,
        username: '1egoman',
        email: null,
        githubId: '1704236',
        accessToken: 'ACCESS TOKEN',
        publicScope: false,
        createdAt: '2017-08-09T12:00:36.000Z',
        lastLoggedInAt: '2017-08-16T12:50:40.203Z',
        updatedAt: '2017-08-16T12:50:40.204Z',
      },
      link: {
        id: 8,
        name: 'My Link',
        enabled: true,
        webhookId: '37948270678a440a97db01ebe71ddda2',
        lastSyncedAt: '2017-08-17T11:37:22.999Z',
        upstreamType: 'repo',
        upstreamOwner: '1egoman',
        upstreamRepo: 'backstroke',
        upstreamIsFork: null,
        upstreamBranches: '["inject","master"]',
        upstreamBranch: 'master',
        forkType: 'repo',
        forkOwner: 'rgaus',
        forkRepo: 'backstroke',
        forkBranches: '["master"]',
        forkBranch: 'master',
        createdAt: '2017-08-11T10:17:09.614Z',
        updatedAt: '2017-08-17T11:37:23.001Z',
        ownerId: 1,
        owner: {
          id: 1,
          username: '1egoman',
          email: null,
          githubId: '1704236',
          accessToken: 'ACCESS TOKEN',
          publicScope: false,
          createdAt: '2017-08-09T12:00:36.000Z',
          lastLoggedInAt: '2017-08-16T12:50:40.203Z',
          updatedAt: '2017-08-16T12:50:40.204Z',
        }
      },
    });

    // Run the worker that eats off the queue.
    await processBatch(
      MockWebhookQueue,
      MockWebhookStatusStore,
      () => null, // console.log.bind(console, '* '),
      getForksForRepo,
      require('./helpers').createPullRequest,
      didRepoOptOut
    );

    // Make sure that it worked
    const response = MockWebhookStatusStore.keys[enqueuedAs].status;
    assert.equal(response.status, 'ERROR');
    assert.equal(response.output.error, `Repository foo/bar doesn't exist!`);
  });

  it('should create a pull request on each fork when given a bunch of forks, but one fails', async () => {
    const createPullRequest = require('./helpers').createPullRequest;
    const getForksForRepo = sinon.stub().resolves([
      {owner: {login: 'hello'}, name: 'world'},
      {owner: {login: 'another'}, name: 'repo'},
    ]);
    const didRepoOptOut = sinon.stub().resolves(false);

    const pullRequestMock = sinon.stub();
    pullRequestMock.onCall(0).yields(null);
    pullRequestMock.onCall(1).yields(new Error('Something bad happened.'));
    const githubPullRequestsCreate = () => pullRequestMock;

    const enqueuedAs = await MockWebhookQueue.push({
      type: 'MANUAL',
      user: {
        id: 1,
        username: '1egoman',
        email: null,
        githubId: '1704236',
        accessToken: 'ACCESS TOKEN',
        publicScope: false,
        createdAt: '2017-08-09T12:00:36.000Z',
        lastLoggedInAt: '2017-08-16T12:50:40.203Z',
        updatedAt: '2017-08-16T12:50:40.204Z',
      },
      link: {
        id: 8,
        name: 'foo',
        enabled: true,
        webhookId: '37948270678a440a97db01ebe71ddda2',
        lastSyncedAt: '2017-08-17T11:37:22.999Z',
        upstreamType: 'repo',
        upstreamOwner: '1egoman',
        upstreamRepo: 'biome',
        upstreamIsFork: null,
        upstreamBranches: '["inject","master"]',
        upstreamBranch: 'master',
        forkType: 'fork-all',
        forkOwner: undefined,
        forkRepo: undefined,
        forkBranches: undefined,
        forkBranch: undefined,
        createdAt: '2017-08-11T10:17:09.614Z',
        updatedAt: '2017-08-17T11:37:23.001Z',
        ownerId: 1,
        owner: {
          id: 1,
          username: '1egoman',
          email: null,
          githubId: '1704236',
          accessToken: 'ACCESS TOKEN',
          publicScope: false,
          createdAt: '2017-08-09T12:00:36.000Z',
          lastLoggedInAt: '2017-08-16T12:50:40.203Z',
          updatedAt: '2017-08-16T12:50:40.204Z',
        },
      },
    });

    // Run the worker that eats off the queue.
    await processBatch(
      MockWebhookQueue,
      MockWebhookStatusStore,
      () => null, //console.log.bind(console, '* '),
      getForksForRepo,
      createPullRequest,
      didRepoOptOut,
      githubPullRequestsCreate
    );

    // Make sure that it worked
    const response = MockWebhookStatusStore.keys[enqueuedAs].status;
    assert.equal(response.status, 'OK');
    assert.deepEqual(response.output, {
      many: true,
      metrics: {total: 2, successes: 1},
      errors: [
        {
          status: 'ERROR',
          error: `Couldn't create pull request on repository another/repo: Something bad happened.`,
        },
      ],
      isEnabled: true,
    });

    // Should have created two pull requests.
    assert.equal(pullRequestMock.callCount, 2);
  });
});
