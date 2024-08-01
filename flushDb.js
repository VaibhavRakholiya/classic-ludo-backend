const redisClient = require("./redis/redis");

//fucntion use for clear all redis cache from server 
//for this just need to run node flushDb.js from root folder
redisClient.flushall()