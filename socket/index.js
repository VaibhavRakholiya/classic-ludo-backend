var _ = require('lodash');
var _TableInstance = require('./controller/_table');

var localization = require('./../api/service/localization');

var logger = require('../api/service/logger');
var AsyncLock = require('async-lock');
var lock = new AsyncLock();

const dotenv = require('dotenv');
dotenv.config();
const { getUser } = require('./helper/demo_users');
const {SOC_save, SOC_getUserId, getTable} = require('../redis/service/socket');
const table = require('../api/models/table');
var fs = require('fs');
const path = require('path');
let filePath = path.resolve(__dirname, `../logs`)

module.exports = function (io) {
    io.on('connection', function (socket) {
        console.log('TS1 ::', 'connect', socket.id);

        //Event made for testing puropse
        socket.on('panel', function () {
            socket.join('panel');
        });
        
        //Event made for check pings but not using yet
        socket.on('ping', function (params, callback) {
            // console.log('PING', socket.id, params, socket.id);
            return callback(params);
        });
        
        //Event made for testing purpose
        socket.on('knock_knock', async (params, callback) => {
            console.log('TS1 ::', 'knock_knock', socket.id, JSON.stringify(params));
            // return callback(params);
            socket.emit('knock_knock', params);
        });

        //Event use for store socket_id and user_id map in redis for rafrance
        socket.on('join', async (params, callback) => {
            console.log("TS1 ::", 'join', socket.id, params, process.env.NODE_ENV=="live");
            // let fresh_start = params.fresh_start&& params.fresh_start.toLowerCase()=="true"?true:false;
            lock.acquire("key1", async function(done) {
            try {      
              startTime = new Date();
              let us;
              if(process.env.NODE_ENV=="live"){
              us={user_name: params.user_name,userId:params.user_id,profile_pic:params.profile_pic }
              }else{
                us=params
              }
              if (us) {
                console.log('User token Found in ', us);
                startTime = new Date();
      
                socket.userId = us.user_id.toString();
                await SOC_save(us.user_id.toString(), socket.id)
                
                // var rez={}
                // if(!fresh_start){
                var rez= await _TableInstance.reconnectIfPlaying(us.user_id.toString());
                // }else{
                //     rez.status=0;
                // }                
      
                var rezObj = {
                  status: 1,
                  message: 'Socket registered successfully',
                  server_time: new Date().getTime().toString(),
                };
      
                rezObj.joined = rez.status;
                if(rezObj.joined>0){rezObj.table= rez.table}

                console.log("TS1::--------->", JSON.stringify(rezObj));
      
                // Game-sync
                console.log("TS1 ::", 'joinRes', socket.id, JSON.stringify(rezObj));
                done()
                return callback(rezObj);
              } else {
                logger.debug('Token expired');
                // Game-sync
                console.log("TS1 ::", 'joinRes', socket.id, JSON.stringify({
                    status: 3,
                    message: localization.tokenExpired
                }));
                done();
                return callback({
                  status: 3,
                  message: localization.tokenExpired,
                });
              }
            } catch (err) {
              console.log('ERR', err);
              if (typeof callback == "function")
                  done();
                  return callback({
                    status: 0,
                    message: 'Error occurred, Please try again.'
                  });
            }
            
        }, function(err, ret) {
            console.log("join event lock release", new Date());
        }, {});
        });

        /*Event use for check room for users requirment is available or not
        if available then  join user in that room else create new room */
        socket.on('joinPublicTabel', async (params, callback) => {
            lock.acquire("key2", async function(done) {
            console.log('TS1 ::', 'joinPublicTabel', socket.id, JSON.stringify(params));
            var myId =await  SOC_getUserId(socket.id);
            if(!params.token){ 
                done()
                return callback({
                status: 0,
                message: 'Please enter token'
              });}
            console.log("id", myId)
            if (!myId) {
                done()
                console.log('Socket disconnected');
                return callback({
                    status: 0,
                    message: 'SOCKET_DISCONNECTED',
                });
            }
            let us;
            if(process.env.NODE_ENV=="live"){
                params.us={user_name: params.user_name,user_id:params.user_id,profile_pic:params.profile_pic }
            }else{
                us=params
            }
            // join_public is function for check room for users requirment is available or not if available then  join user in that room else create new room
            var rez = await _TableInstance.join_public(params, myId, io);
            console.log("REZ", rez);
            callback(rez.callback);
            if (rez.callback.status == 1) {
                socket.join(rez.callback.table.room);
                processEvents(rez);
                var params_data = {
                    room: rez.callback.table.room,
                };
                //startIf Possible function is use for check all players are joined room if all players joined then it returns true else returns false
                var start = await _TableInstance.startIfPossible(params_data);
                console.log("Start", start);
                if (start) {
                    //function use for call deduct_money API
                    let deductM =(process.env.USE_API=="false") ?true: await _TableInstance.deductMoney(start.table);
                    //if response true then start game else remove table from redis cache 
                    if (deductM) {
                        setTimeout(function () {
                            //this event fire socket event for start game in room
                            io.to(start.room).emit('startGame', start);

                            /*this setInterval event call wvwny 1 seca nd check game is completed or not and 
                            also check if 29 sec complete then it will skip turn  
                            and also execute code for auto move */
                            setInterval(async function () {
                                var checkTabel = await _TableInstance.istableExists(params_data);
                                let currentTimer= Math.floor((parseInt(new Date().getTime()) - checkTabel.start_at)/1000)
                                console.log("Timer",currentTimer);
                                // this event emit turn_timer event every second for handle timer in unity
                                processEvents({
                                    callback: {
                                        status: 2,
                                        message: localization.success,
                                    },
                                    events: [
                                        {
                                            type: 'room_including_me',
                                            room: start.room,
                                            name: 'turn_timer',
                                            delay: 0,
                                            data: {
                                                room:start.room,
                                                position: checkTabel.current_turn,
                                                timer: currentTimer,
                                            },
                                        },
                                    ],
                                })
                                
                                //if game completed and winner declared in game it will stop timer here
                                if (!checkTabel.status) {
                                    console.log('TABLE DOES NOT EXIST, STOP');
                                    clearInterval(this);
                                } else {
                                    var id_of_current_turn = await _TableInstance.getMyIdByPossition(
                                        params_data,
                                        checkTabel.current_turn
                                    );
                                    
                                    //this is code for auto move and auto diceroll
                                    /*if timer is grater than 1 and current_turn_type= move(this state is update everytime when turn changes it set to romm and move)
                                    so if type move then it check only one token is movable then it will move that token automatically*/
                                    if (currentTimer >= 1 && checkTabel.table.current_turn_type=="move") {
                                        let isInitial= await _TableInstance.isAllAtInitial(checkTabel.table.room,id_of_current_turn)
                                        if(isInitial){
                                            let user= checkTabel.table.users[checkTabel.table.current_turn]
                                            params={room:checkTabel.table.room,autoMove:"False", token_index:"0",dice_value:user.dices_rolled[0]}
                                            let rez= await _TableInstance.moveMade(params,id_of_current_turn, socket)
                                            console.log("rez", rez);
                                            callback(rez.callback);
                                            if (rez.callback.status == 1) processEvents(rez);

                                        }
                                        let movableTokenCount=await _TableInstance.getMovableTokenCount(checkTabel.table.room,id_of_current_turn)
                                        console.log("movable token count", movableTokenCount);
                                        if(movableTokenCount==1){
                                        let user= checkTabel.table.users[checkTabel.table.current_turn]
                                        let movableToken=await _TableInstance.getMovableToken(checkTabel.table.room,id_of_current_turn)
                                        console.log("movable token", movableToken, user);
                                        params={room:checkTabel.table.room,autoMove:"False", token_index:""+movableToken,dice_value:user.dices_rolled[0]}
                                        let rez= await _TableInstance.moveMade(params,id_of_current_turn, socket)
                                        console.log("rez", rez);
                                        callback(rez.callback);
                                        if (rez.callback.status == 1) processEvents(rez);
                                        }
                                    }
                                    
                                    //this is for auto dice and auto move if player is not click on token or roll dice till 29 seconds
                                    if (currentTimer >= 29) {
                                        console.log('Skip Turn due to server timeout');
                                        console.log('ID of current turn user::', checkTabel);

                                        if(checkTabel.table.current_turn_type=="move"){
                                            let user= checkTabel.table.users[checkTabel.table.current_turn]
                                            let movableToken=await _TableInstance.getMovableToken(checkTabel.table.room,id_of_current_turn)
                                            console.log("movable token", movableToken, user);
                                            params={room:checkTabel.table.room,autoMove:"True", token_index:""+movableToken,dice_value:user.dices_rolled[0]}
                                            let rez= await _TableInstance.moveMade(params,id_of_current_turn, socket)
                                            callback(rez.callback);
                                            if (rez.callback.status == 1) processEvents(rez);
                                        }
                                        if(checkTabel.table.current_turn_type=="roll"){
                                            console.log("dice", checkTabel.table.users[checkTabel.table.current_turn]);
                                            params={room:checkTabel.table.room,autoDice:"True"}
                                            let rez= await _TableInstance.diceRolled(socket,params,id_of_current_turn)
                                            callback(rez.callback);
                                            if (rez.callback.status == 1) processEvents(rez);
                                        }
                                    }

                                }
                            }, 1000);
                        }, 2000);
                    } else {
                        await _TableInstance.abortGame(start.table);
                        io.to(start.room).emit('startGameAbort', start);
                    }
                }
            }
            done()
        }, function(err, ret) {
            console.log("join event lock release", new Date());
        }, {});
        });

        //event is use for join previous game
        socket.on('join_previous', async (params, callback) => {
            // console.log("PARAMS", params);
            console.log('TS1 ::', 'join_previous', socket.id, JSON.stringify(params));
            var myId =await SOC_getUserId(socket.id);
            if (!myId || myId) {
                var tableD = await table.findOne({
                    room:params.room
                });
                if(params.room && tableD.game_completed_at!=-1){
                    var tableD = await table.findOne({
                        room:params.room
                    });
                    console.log(tableD)

                    if(tableD && tableD.game_completed_at!=-1){
                    let endData=await _TableInstance.getEndgameData(params.room);
                    if(endData.status==1 ){
                        console.log("end data rank", endData);
                        io.to(socket.id).emit('end_game', endData.data);
                    }

                    }
            }
            }

                if (!myId) {
                    console.log(
                        'TS1 ::',
                        'JOIN_PREV_RES',
                        socket.id,
                        JSON.stringify({
                            status: 0,
                            message: 'SOCKET_DISCONNECTED',
                        })
                    );
                    // console.log('socket disconnected');
                    return callback({
                        status: 0,
                        message: 'SOCKET_DISCONNECTED',
                    });
                }
            
            console.log("id is", myId)

            var rez = await _TableInstance.reconnectIfPlaying(myId);
            // console.log("<<<<<< JOINPREVRES >>>>", JSON.stringify(rez, undefined, 2));
            if (rez.status == 1) {
                socket.join(rez.table.room);
            }
            console.log('TS1 ::', 'JOIN_PREV_RES', socket.id, JSON.stringify(rez));
            return callback(rez);
        });

        //event is just for testing purpose not using yet
        socket.on('go_in_background', async () => {
            // console.log("PLAYER IN BG NOW", socket.id);
            console.log('TS1 ::', 'go_in_background', socket.id);
            socket.leaveAll();
        });

        //event is user for leave room by room code
        socket.on('leaveTable', async (params, callback) => {
            lock.acquire("key1", async function(done) {
            console.log('TS1 ::', 'leaveTable', socket.id, JSON.stringify(params));
            var myId = await SOC_getUserId(socket.id);
            console.log("my id", myId)
            let table = await getTable(params.room)
            console.log("table && table.current_turn",table, table.current_turn, table.current_turn!=-1)
            if(table && table.current_turn!=-1){
                if(table.users[table.current_turn].id==myId)
                {
                console.log("in herer final logs")
                await processEvents(await _TableInstance.isCurrentPlayerLeaving(params.room, myId))
                var rez = await _TableInstance.leaveTable(params, myId);
                callback(rez.callback);
                if (rez.callback.status == 1) processEvents(rez);
                socket.broadcast.emit('broadcast_count', {
                status: 1,
                message: 'Success',
                })
                }else{
                var rez = await _TableInstance.leaveTable(params, myId);
                callback(rez.callback);
                if (rez.callback.status == 1) processEvents(rez);
                socket.broadcast.emit('broadcast_count', {
                    status: 1,
                    message: 'Success',
                });
                }
            }else{
            var rez = await _TableInstance.leaveTable(params, myId);
            callback(rez.callback);
            if (rez.callback.status == 1) processEvents(rez);
            socket.broadcast.emit('broadcast_count', {
                status: 1,
                message: 'Success',
            });
            }
            done();
        }, function(err, ret) {
            console.log("authenticate lock release", new Date());
        }, {});
        });

        //event is use for roll dice
        socket.on('dice_rolled', async (params, callback) => {
        lock.acquire("key1", async function(done) {
            console.log("TS1 ::", 'dice_rolled', socket.id, JSON.stringify(params));
            // console.log(socket.data_name, " Rolled ", params.dice_value);
            var myId = await SOC_getUserId(socket.id);

            var rez = await _TableInstance.diceRolled(socket, params, myId);           
            callback(rez.callback);
            if (rez.callback.status == 1) processEvents(rez);
            done()
        }, function(err, ret) {
            console.log("diceroll event lock release", new Date());
        }, {});
        });

        //event is use for make move
        socket.on('move_made', async (params, callback) => {
            lock.acquire("key1", async function(done) {
            // console.log("TS1 ::", 'move_made', socket.id, JSON.stringify(params));
            console.log(socket.id, ' Moved token ', params.token_index, ' By ', params.dice_value, ' places');

            var myId = await SOC_getUserId(socket.id);
            var rez = await _TableInstance.moveMade(params, myId, socket);
            callback(rez.callback);
            if (rez.callback.status == 1) await processEvents(rez);
            done()
            
        }, function(err, ret) {
            console.log("diceroll event lock release", new Date());
        }, {});

        });

        //event is use for send emoji
        socket.on('send_emoji', async (params, callback) => {
            console.log('TS1 ::', 'send_emoji', socket.id, JSON.stringify(params));
            var rez = await _TableInstance.sendEmoji(params);
            // console.log('Send Emoji RES');
            callback(rez.callback);
            processEvents(rez);
        });

        //event is for testing not using yet
        socket.on('srever_time', async (params, callback) => {
            console.log('TS1 ::', 'srever_time', socket.id, JSON.stringify(params));
            return callback({
                status: 1,
                message: 'Server Time',
                server_time: new Date().getTime().toString(),
            });
        });

        //function is use for send event to user as per requirement
        async function processEvents(rez) {
            if (_.isArray(rez.events)) {
                if (rez.events.length > 0) {
                    for (const d of rez.events) {
                        let demoLogger = () => {
                            let current_datetime = new Date();
                            let formatted_date =
                                current_datetime.getFullYear() +
                                "-" +
                                (current_datetime.getMonth() + 1) +
                                "-" +
                                current_datetime.getDate() +
                                " " +
                                current_datetime.getHours() +
                                ":" +
                                current_datetime.getMinutes() +
                                ":" +
                                current_datetime.getSeconds();
                            let log = `[${formatted_date}]: ${d.name} :${JSON.stringify(d.data)}`;
                            fs.appendFile(`${filePath}/${d.room}.txt`, log + "\n", err => {
                                if (err) {
                                    console.log(err);
                                }
                            });
                        };
                        //demologger is function use for print event wich we send to unity as per room code 
                        demoLogger()
                        setTimeout(
                            async function () {
                                // console.log(d.name + ' firing after delay of ' + d.delay?d.delay:0);
                                if (d.type == 'room_including_me') {
                                    io.to(d.room).emit(d.name, d.data);
                                } else if (d.type == 'room_excluding_me') {
                                    socket.to(d.room).emit(d.name, d.data);
                                }
                            },
                            //delay will emit event after delay send in function
                            d.delay ? d.delay : 0
                        );
                    }
                }
            }
        }
    });
};
