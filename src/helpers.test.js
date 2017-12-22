const sinon = require('sinon');
const assert = require('assert');
const tmp = require('tmp-promise');

const {createPullRequest, generatePullRequestTitle, generatePullRequestBody} = require('./helpers');
const noop = () => null;

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
  links: {},
  reset() {
    this.keys = {};
    this.links = {};
  },

  set(webhookId, status) {
    const id = (new Date()).getTime();
    this.keys[webhookId] = {status, id};
    return Promise.resolve(id);
  },
  get(webhookId) {
    return Promise.resolve(this.keys[webhookId].status);
  },
  attachToLink(linkId, webhookId) {
    this.links[linkId] = [
      ...(this.links[linkId] || []),
      webhookId,
    ];
    return Promise.resolve();
  }
};


const USER = {
  id: 1,
  username: '1egoman',
  email: null,
  githubId: '1704236',
  accessToken: 'ACCESS TOKEN',
  publicScope: false,
  createdAt: '2017-08-09T12:00:36.000Z',
  lastLoggedInAt: '2017-08-16T12:50:40.203Z',
  updatedAt: '2017-08-16T12:50:40.204Z',
};

const LINK = {
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
  },
};

describe('helpers', () => {
  it('should create a pull request when given a valid fork and upstream', async () => {
    const createPr = sinon.stub().yields(null);
    const githubPullRequestsCreate = () => createPr;
    const debug = noop;

    const response = await createPullRequest(
      USER,
      LINK,
      { owner: '1egoman', repo: 'backstroke', branch: 'master' },
      { owner: 'rgaus', repo: 'backstroke', branch: 'fancy-branch' },
      debug,
      githubPullRequestsCreate
    );

    // Ensure that the pull request was created.
    assert.equal(response, 'Successfully synced link.');

    // Ensure that the pull request create call was called correctly.
    assert.deepEqual(createPr.firstCall.args[0], {
      owner: 'rgaus',
      repo: 'backstroke',
      title: generatePullRequestTitle('1egoman', 'backstroke', 'master'),
      head: `1egoman:master`,
      base: 'fancy-branch',
      body: generatePullRequestBody(LINK),
      maintainer_can_modify: false,
    });
  });
  it('should gracefully handle errors thrown when making the github pull request', async () => {
    const createPr = sinon.stub().yields(new Error('Random error!'));
    const githubPullRequestsCreate = () => createPr;
    const debug = noop;

    try {
      await createPullRequest(
        USER,
        LINK,
        { owner: '1egoman', repo: 'backstroke', branch: 'master' },
        { owner: 'rgaus', repo: 'backstroke', branch: 'fancy-branch' },
        debug,
        githubPullRequestsCreate
      );
    } catch (err) {
      // Ensure that the error was thrown correctly.
      assert.equal(err.message, `Couldn't create pull request on repository rgaus/backstroke: Random error!`);
      return
    }

    throw new Error(`createPullRequest didn't throw an error!`);
  });
  it('should specially handle error cases that can be explained more thoroughly', async () => {
    const createErrorWithCode = (msg, code) => {
      const err = new Error(msg);
      err.code = code;
      err.message = msg;
      return err;
    };

    // An object mapping an error to its expected rejection from the `createPullRequest` function.
    // In other words, these are our test cases.
    const ERROR_CASES = [
      {
        throwThisError: createErrorWithCode('{"errors": [{"message": "No commits between fancy-branch and master"}]}', 422),
        expectThisRejection: `The upstream and fork are already up to date.`,
      },
      {
        throwThisError: createErrorWithCode('{"errors": [{"message": "A pull request already exists for rgaus:backstroke"}]}', 422),
        expectThisRejection: `A Backstroke pull request is already open on the fork.`,
      },
      {
        throwThisError: createErrorWithCode('Not found', 404),
        expectThisRejection: `Repository rgaus/backstroke doesn't exist.`,
      },
      {
        throwThisError: createErrorWithCode('Server Error', 500),
        expectThisRejection: `Couldn't create pull request on repository rgaus/backstroke: A Github api call returned a 500-class status code (500). Please try again.`,
      },
    ];

    const all = ERROR_CASES.map(async ({throwThisError, expectThisRejection}) => {
      const createPr = sinon.stub().yields(throwThisError);
      const githubPullRequestsCreate = () => createPr;
      const debug = noop;

      const response = await createPullRequest(
        USER,
        LINK,
        { owner: '1egoman', repo: 'backstroke', branch: 'master' },
        { owner: 'rgaus', repo: 'backstroke', branch: 'fancy-branch' },
        debug,
        githubPullRequestsCreate
      );
      assert.equal(response, expectThisRejection);
    });

    return Promise.all(all);
  });
});
