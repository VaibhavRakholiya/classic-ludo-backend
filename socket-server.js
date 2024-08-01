require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const router = express.Router();
const http = require('http');
const config = require('./config');
const mongoose = require('mongoose');
const morgan = require('morgan');
var logger = require('./api/service/logger');
let path=require("path")

morgan.token('host', function(req) {
	return req.hostname;
});

// setup the logger 
app.use(morgan(':method :host :url :status :res[content-length] - :response-time ms'));

app.use(function(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

app.get('/document' , (req,res)=>{
    res.sendFile(path.join(__dirname +'/socket_documentation' , 'index1.html'))
});

//this function provide connecttion_details.json file i root folder
//used by unity dev to access current urls
app.get('/' , (req,res)=>{
    res.sendFile(path.join(__dirname  , 'connection_details.json'))
});

require('./routes/index')(router);

app.use(
    bodyParser.urlencoded({
        extended: true,
        type: 'application/x-www-form-urlencoded'
    })
);

app.use(bodyParser.json());
app.use('/', router);

const server = http.createServer(app);
const socket = require('socket.io')(server);
require('./socket')(socket);

//DB connection
mongoose
  .connect(process.env.MONGO_LOCAL)
  .then(async(result) => {
    console.log("db connected");
    server.listen(config.port, function() {
        logger.info('Socket Server listening at PORT:' + config.port);
    });
  })
  .catch(err => {
    console.log(err);
  });

module.exports = server;
