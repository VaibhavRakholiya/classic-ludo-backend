const redis = require('redis');
const bluebird = require('bluebird');
const {REDIS_PASSWORD, REDIS_HOST, REDIS_PORT} = require('../config/index');
const CronJob = require('cron').CronJob;

bluebird.promisifyAll(redis);
if (!REDIS_PASSWORD) {
    console.log("redis local", REDIS_HOST, REDIS_PORT)
    var redisClient = redis.createClient(REDIS_PORT, REDIS_HOST);
    redisClient.select(1);
} else {
    console.log("password...")
    var redisClient = redis.createClient({
        host: REDIS_HOST,
        port: REDIS_PORT,
        password: REDIS_PASSWORD,
        retry_strategy: function (options) {

            if (options.total_retry_time > 2000) {
                console.log("throwing an error...");
                return new Error('Retry time exhausted');
            }

            return 200;
        }
    });
    // redisClient.select(2);
}

// Redis flush
async function flushDB() {
    console.log('Redis flush executed::', new Date().getTime());
    await redisClient.flushall("ASYNC", function (err, succeeded) {
        console.log(succeeded); // will be true if successfull
		if(succeeded){
			console.log("CornJob: Email Notifiaction Called");
			// Email.cornJobNotify();
		}
    });
}


redisClient.on("error", function(error) {
	console.error(error);
});

redisClient.on('connect', function () {
	console.log('Connected to Redis');
	const flushDBCron = new CronJob('30 5 * * *', function () {
		flushDB();
	}, null, true, 'Asia/Kolkata');
	flushDBCron.start();
});

module.exports = redisClient;
