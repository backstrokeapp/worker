const args = require('minimist')(process.argv.slice(2));

const RedisMQ = require('rsmq');
const redis = require('redis').createClient(process.env.REDIS_URL);
const redisQueue = new RedisMQ({client: redis, ns: 'rsmq'});

// Perform a webhook update.
const processBatch = require('./worker');
const getForksForRepo = require('./helpers').getForksForRepo;

const mockCreatePullRequest = async (...args) => console.log('  *', require('chalk').green('MOCK CREATE PR'), args);
const createPullRequest = require('./helpers').createPullRequest;
const didRepoOptOut = require('./helpers').didRepoOptOut;

const githubPullRequestsCreate = github => github.pullRequests.create

const ONE_HOUR_IN_SECONDS = 60 * 60;
const WebhookStatusStore = {
  set(webhookId, status, expiresIn=ONE_HOUR_IN_SECONDS) {
    return new Promise((resolve, reject) => {
      redis.set(`webhook:status:${webhookId}`, JSON.stringify(status), 'EX', expiresIn, (err, id) => {
        if (err) {
          reject(err);
        } else {
          // Resolves the message id.
          resolve(id);
        }
      });
    });
  },
  get(webhookId) {
    return new Promise((resolve, reject) => {
      redis.get(`webhook:status:${webhookId}`, (err, data) => {
        if (err) {
          reject(err);
        } else {
          // Resolves the cached data.
          resolve(JSON.parse(data));
        }
      });
    });
  },
};

const WebhookQueue = {
  queueName: process.env.REDIS_QUEUE_NAME || 'webhookQueue',
  initialize() {
    return new Promise((resolve, reject) => {
      redisQueue.createQueue({qname: this.queueName}, (err, resp) => {
        if (err && err.name === 'queueExists') {
          // Queue was already created.
          resolve();
        } else if (err) {
          reject(err);
        } else {
          resolve(resp);
        }
      });
    });
  },
  push(data) {
    return new Promise((resolve, reject) => {
      redisQueue.sendMessage({qname: this.queueName, message: JSON.stringify(data)}, (err, id) => {
        if (err) {
          reject(err);
        } else {
          // Resolves the message id.
          resolve(id);
        }
      });
    });
  },
  pop() {
    return new Promise((resolve, reject) => {
      redisQueue.popMessage({qname: this.queueName}, (err, data) => {
        if (err) {
          reject(err);
        } else if (!data || typeof data.id === 'undefined') {
          // No items in the queue
          resolve(null);
        } else {
          // Item was found on the end of the queue!
          resolve({data: JSON.parse(data.message), id: data.id});
        }
      });
    });
  },
};
WebhookQueue.initialize();


// Logging function to use in webhooks.
function logger() {
  console.log.apply(console, ['   *', ...arguments]);
}


if (require.main === module) {
  // Called once the process finishes.
  function final() {
    redis.quit();
  }

  // Kick off the batch!
  processBatch(
    WebhookQueue,
    WebhookStatusStore,
    logger,
    getForksForRepo,
    {default: createPullRequest, mock: mockCreatePullRequest}[args.pr || 'default'],
    didRepoOptOut,
    githubPullRequestsCreate
  ).then(() => {
    console.log('* Success!');
    final();
  }).catch(err => {
    console.error('Error:');
    console.error(err.stack);
    final();
  });
}
