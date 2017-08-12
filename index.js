const redis = require('redis').createClient(process.env.REDIS_URL);
const RedisMQ = require('rsmq');
const redisQueue = new RedisMQ({
  client: redis,
  ns: 'rsmq',
});

const OK = 'OK', RUNNING = 'RUNNING', ERROR = 'ERROR';
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
      redisQueue.popMessage({qname: this.queueName}, (err, {message, id}) => {
        if (err) {
          reject(err);
        } else if (typeof id === 'undefined') {
          // No items in the queue
          resolve(null);
        } else {
          // Item was found on the end of the queue!
          resolve({data: message, id});
        }
      });
    });
  }
};
WebhookQueue.initialize();

// Logging function to use in webhooks.
function logger() { console.log.apply(console, ['   *', ...arguments]); }

// The batch processing function. Eats off the queue and publishes results to redis.
async function processBatch(WebhookQueue, WebhookStatusStore) {
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
    const content = JSON.parse(webhook.data);
    const link = content.link;
    const user = content.user;

    // Log the type of update that is happening.
    console.log(`=> * Handling webhook ${webhook.id}:`);
    logger(`From: ${link.upstreamOwner}/${link.upstreamRepo}@${link.upstreamBranch}`);
    if (link.forkType === 'fork-all') {
      logger(`To: all forks @ ${link.upstreamBranch} (uses upstream branch)`);
    } else {
      logger(`To: ${link.forkOwner}/${link.forkRepo}@${link.forkBranch}`);
    }

    /* TODO: do the thing! :) */
    const output = {foo: 'bar'};

    // Successful! Update redis to say so.
    await WebhookStatusStore.set(webhook.id, {
      status: OK,
      startedAt,
      finishedAt: (new Date()).toISOString(),
      output,
    });
  }
}

// Every once and a while, process a new batch of webhook events
const UPDATE_SECONDS = 30;
if (require.main === module) {
  processBatch(WebhookQueue, WebhookStatusStore).then(() => {
    setInterval(() => processBatch(WebhookQueue, WebhookStatusStore), UPDATE_SECONDS * 1000);
  });
}
