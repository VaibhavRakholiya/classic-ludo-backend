var Table = require('./../../api/models/table');
var Service = require('./../../api/service');
var config = require('./../../config');
var localization = require('./../../api/service/localization');
var logger = require('../../api/service/logger');
var ObjectId = require('mongoose').Types.ObjectId;
var rest_api = require("../../api/rest_api")

var _ = require('lodash');

const { _Tables } = require('../utils/_tables');
var _tab = new _Tables();

const { getUser } = require('../helper/demo_users');

const dotenv = require('dotenv');
const { getTable, getTableFromUser, removeTable } = require('../../redis/service/socket');
const table = require('./../../api/models/table');
dotenv.config();

module.exports = {
    // function handle all events and next move when roll dice
    diceRolled: async function (socket, params, id) {
        console.log("in dice rolled", id);

        var resObj = { callback: { status: 1, message: localization.success }, events: [] };

        // VALIDATE PARAMS
        if (!params) return { callback: { status: 0, message: localization.missingParamError } };
        if (!params.room) return { callback: { status: 0, message: localization.missingParamError } };

        // check user exist in room
        var myPos = await _tab.getMyPosition(params.room, id);
        if (myPos == -1) return { callback: { status: 0, message: localization.noDataFound } };

        //check it is valid user
        let myTurn = await _tab.isCurrentTurnIsMine(params.room, id, "roll");
        console.log("is currnt turn is mine",myTurn)
        if (!myTurn) return { callback: { status: 0, message:"your turn is already completed"} };

        let autoDice= params.autoDice? params.autoDice.toLowerCase() =="true"?true:false: false
        console.log("autoDice", autoDice);
        //code for fix dice value

        /*let fixedDice= params.fixedDice? params.fixedDice.toLowerCase() =="true"?true:false: false
        if(fixedDice){
            console.log("in fixed dice");
            let dice= parseInt(params.diceValue);
            await _tab.updateMyDice(params.room,id,dice)
        }*/

        var DICE_ROLLED = await _tab.getMyDice(params, id);
        console.log(socket.id, ' Rolled ', DICE_ROLLED);

        if (DICE_ROLLED > 6 || DICE_ROLLED < 0) return { callback: { status: 0, message: localization.noDataFound } };

        resObj.callback.dice = DICE_ROLLED;
        let dices_rolled = await _tab.gePlayerDices(params.room, myPos);
        // resObj.callback.dices_rolled = dices_rolled;
        
        // id auto diceroll then deduct 1 life and check is all life used then leave user from room and check for end game
        if(autoDice){
            let mypos = await _tab.getMyPosition(params.room, id);
            var checkLife = await _tab.getMyLife(params.room, id);
            console.log("in deduct life", checkLife);
             if (checkLife == 0) {
                let table= await getTable(params.room)

                var life_event = {
                    type: 'room_including_me',
                    room: params.room,
                    name: 'life_deduct',
                    data: {
                        room: params.room,
                        position: myPos,
                    },
                };
                resObj.events.push(life_event);
                console.log("in deduct life");
                //leave table and pass turn to next player
                var rez = await _tab.leave(params.room, id);
                console.log("leave rez", rez);
                if (!rez.res) {
                    return {
                        callback: {
                            status: 0,
                            message: localization.ServerError,
                        },
                    };
                } else {
                    if(table.no_of_players!=2){
                    var player_left = 
                            {
                                type: 'room_including_me',
                                room: params.room,
                                name: 'playerLeft',
                                delay: 1500,
                                data: {
                                    room: params.room,
                                    position: rez.position,
                                },
                    };
                    resObj.events.push(player_left);
                    }
                    var checkOnlyPlayerLeft = await _tab.checkOnlyPlayerLeft(params.room);
                    console.log("checkOnlyPlayerLeft",checkOnlyPlayerLeft);
                    // CheckIfOnlyPlayerLeft
                    if (checkOnlyPlayerLeft) {
                        // Check if EndGame Possible
                        var endGame = await _tab.isThisTheEnd(params.room);
                        if (endGame) {
                            // Update values in user wallets & table data [DB]
                            let tableD = await Table.findOne({
                                room: params.room,
                            });
                            if (tableD) {
                                for (let j = 0; j < endGame.length; j++) {
                                    for (let k = 0; k < tableD.players.length; k++) {
                                        if (endGame[j].id.toString() == tableD.players[k].id.toString()) {
                                            tableD.players[k].rank = endGame[j].rank;
                                            tableD.players[k].pl += endGame[j].amount;
                                        }
                                    }
                                }
                                tableD.game_completed_at = new Date().getTime();
                                tableD
                                    .save()
                                    .then((d) => {
                                    })
                                    .catch((e) => {
                                    });
                            }
                            // Update values in user wallets & table data [DB]
                            let event = {
                                type: 'room_including_me',
                                room: params.room,
                                delay: 2000,
                                name: 'end_game',
                                data: {
                                    room: params.room,
                                    game_data: endGame,
                                },
                            };
                            resObj.events.push(event);
                            return resObj
                        }
                        // Else [!endGame]
                        else {
                            console.log("in make diceroll1")
                            let myPos = await _tab.getMyPosition(params.room, id);
                            //  SCRAP CURRENT DICES & PASS NEXT DICE_ROLL
                            await _tab.scrapTurn(params.room, myPos);
                            // DICE_ROLL TO NEXT
                            let nextPos = await _tab.getNextPosition(params.room, myPos);
                            await _tab.updateCurrentTurn(params.room, nextPos, 'roll', myPos);
                            let DICE_ROLLED = _tab.rollDice();
                            await _tab.diceRolled(params.room, nextPos, DICE_ROLLED,true);
                            let dices_rolled = await _tab.gePlayerDices(params.room, nextPos);
    
                            // SEND EVENT
                            let event = {
                                type: 'room_including_me',
                                room: params.room,
                                delay: 800,
                                name: 'make_diceroll',
                                data: {
                                    room: params.room,
                                    position: nextPos,
                                    // tokens: await _tab.getTokens(params.room),
                                    dice: DICE_ROLLED,
                                    dices_rolled: dices_rolled,
                                },
                            };
                            resObj.events.push(event);
                        }
                    } else {
                        // let mypos = await _tab.getMyPosition(params.room, id);
                        logger.info('My position::', mypos);
                        if (mypos != -1) {
                            let check = await _tab.isCurrentTurnMine(params.room, mypos);
                            if (check) {
                                //  SCRAP CURRENT DICES & PASS NEXT DICE_ROLL
                                await _tab.scrapTurn(params.room, mypos);
                                // nextPosition find & add event dice_roll
                                let nextPos = await _tab.getNextPosition(params.room, mypos);
                                await _tab.updateCurrentTurn(params.room, nextPos, 'roll', mypos);
                                let DICE_ROLLED = _tab.rollDice();
                                await _tab.diceRolled(params.room, nextPos, DICE_ROLLED,true);
                                let dices_rolled = await _tab.gePlayerDices(params.room, nextPos);
                                let event = {
                                    type: 'room_including_me',
                                    room: params.room,
                                    delay: 800,
                                    name: 'make_diceroll',
                                    data: {
                                        room: params.room,
                                        position: nextPos,
                                        //: await _tab.getTokens(params.room),
                                        dice: DICE_ROLLED,
                                        dices_rolled: dices_rolled,
                                    },
                                };
                                resObj.events.push(event);
                            }
                        }
                    }
                    return resObj;
                }
            }
            else{
            await _tab.deductLife(params.room, id);
            var life_event = {
                type: 'room_including_me',
                room: params.room,
                name: 'life_deduct',
                data: {
                    room: params.room,
                    position: myPos,
                },
            };
            resObj.events.push(life_event);
            console.log("in deduct life");
            }

        }

        // send dice roll event to unity
        let event = {
            type: 'room_including_me',
            room: params.room,
            name: 'dice_rolled',
            data: {
                position: myPos,
                room: params.room,
                dice_value: DICE_ROLLED,
                dices_rolled: dices_rolled,
            },
        };

        resObj.events.push(event);
        await _tab.setLastdiceolled(params.room, DICE_ROLLED)

        var movePossible = await _tab.isMovePossible(params.room, id);
        // IF MOVE POSSIBLE FROM CURRENT DICES & Position

        const jackPOT = await _tab.jackPot(params.room, id);
        let sixCounts = await _tab.getSix(params.room, id);

        if(dices_rolled[0] != 6){
            await _tab.setSix(params.room, id);
        }

        //if six counts =2 (before this dice roll user already got 2 times six in this round) and current roll = 6 then scrap current tuen to next player
        if (sixCounts == 2 && dices_rolled[0] == 6) {
            console.log("here in 3 six counts");
            //  SCRAP CURRENT DICES & PASS NEXT DICE_ROLL
            await _tab.scrapTurn(params.room, myPos);
            // DICE_ROLL TO NEXT
            await _tab.setSix(params.room, id);
            console.log("set six...0")
            let nextPos = await _tab.getNextPosition(params.room, myPos);
            await _tab.updateCurrentTurn(params.room, nextPos, 'roll', myPos);
            let DICE_ROLLED = await _tab.rollDice();
            await _tab.diceRolled(params.room, nextPos, DICE_ROLLED,true);
            let dices_rolled = await _tab.gePlayerDices(params.room, nextPos);
            // SEND EVENT
            let event = {
                type: 'room_including_me',
                room: params.room,
                delay: 1500,
                name: 'make_diceroll',
                data: {
                    room: params.room,
                    position: nextPos,
                    // tokens: await _tab.getTokens(params.room),
                    dice: DICE_ROLLED,
                    dices_rolled: dices_rolled,
                },
            };
            await _tab.clearDices(params.room, myPos);
            resObj.events.push(event);
            return resObj
        }
        //check move is possible or not
        //if move is possible then send make_move event to unity
        if (movePossible) {
            console.log('[MOVE POSSIBLE DICE ROLLED]');
            let timer = 1500;
            var myPos = await _tab.getMyPosition(params.room, id);
            //  MAKE_MOVE TO ME
            _tab.updateCurrentTurn(params.room, myPos, 'move', -1);
            let dices_rolled = await _tab.gePlayerDices(params.room, myPos);
            let movable_token= await _tab.getMovableTokenCount(params.room, id)
            let event = {
                type: 'room_including_me',
                room: params.room,
                delay: timer,
                name: 'make_move',
                data: {
                    room: params.room,
                    position: myPos,
                    dices_rolled: dices_rolled,
                    auto_move:movable_token==1?1:0
                },
            };
            resObj.events.push(event);
        }
        // else scrap turn to next player
        if (!movePossible && !jackPOT) {
            console.log('[MOVE IMPOSSIBLE DICE ROLLED]',);
            //if dice roll not six then give turn to oppnent else give diceroll to current player
            if (DICE_ROLLED != 6) {
                console.log('[DICE ROLLED NOT SIX]');
                //  SCRAP CURRENT DICES & PASS NEXT DICE_ROLL
                await _tab.scrapTurn(params.room, myPos);
                // DICE_ROLL TO NEXT
                let timer = 1500;
                let nextPos = await _tab.getNextPosition(params.room, myPos);
                await _tab.updateCurrentTurn(params.room, nextPos, 'roll', myPos);
                // console.log("player dices", dices_rolled);
                let DICE_ROLLED = await _tab.rollDice();
                await _tab.diceRolled(params.room, nextPos, DICE_ROLLED,true);
                let dices_rolled = await _tab.gePlayerDices(params.room, nextPos);
                let event = {
                    type: 'room_including_me',
                    room: params.room,
                    delay: timer,
                    name: 'make_diceroll',
                    data: {
                        room: params.room,
                        position: nextPos,
                        // tokens: await _tab.getTokens(params.room),
                        dice: DICE_ROLLED,
                        dices_rolled: dices_rolled,
                    },
                };
                resObj.events.push(event);
            } else {
                console.log("in else part");
                await _tab.clearDices(params.room, myPos);
                let DICE_ROLLED = _tab.rollDice();
                await _tab.diceRolled(params.room, myPos, DICE_ROLLED,false);
                await _tab.addSix(params.room, id, 1);
                let timer = 1500
                await _tab.updateCurrentTurn(params.room, myPos, 'roll', -1);
                let dices_rolled = await _tab.gePlayerDices(params.room, myPos);
                let event = {
                    type: 'room_including_me',
                    room: params.room,
                    delay: timer,
                    name: 'make_diceroll',
                    data: {
                        room: params.room,
                        position: myPos,
                        // tokens: await _tab.getTokens(params.room),
                        dice: DICE_ROLLED,
                        dices_rolled: dices_rolled,
                    },
                };
                resObj.events.push(event);
                console.log("event",event );
            }

        }
        return resObj;
    },

    // function handle all events and next move when make move
    moveMade: async function (params, id) {
       console.log('Move Made', params);

        try {
            // VALIDATION
            if (!params) return { callback: { status: 0, message: localization.missingParamError } };
            if (!params.room) return { callback: { status: 0, message: localization.missingParamError } };
            if (!params.token_index) return { callback: { status: 0, message: localization.missingParamError } };
            if (!params.dice_value) return { callback: { status: 0, message: localization.missingParamError } };
            if (parseInt(params.dice_value) > 6)
                return { callback: { status: 0, message: localization.missingParamError } };

            params.token_index = parseInt(params.token_index);
            params.dice_value = parseInt(params.dice_value);

            var resObj = { callback: { status: 1, message: localization.success }, events: [] };

            var myPos = await _tab.getMyPosition(params.room, id);
            if (myPos == -1) return { callback: { status: 0, message: localization.noDataFound } };

            let myTurn = await _tab.isCurrentTurnIsMine(params.room, id, "move");
            console.log("is currnt turn is mine",myTurn)
            if (!myTurn) return { callback: { status: 0, message:"your turn is already completed"} };

            let autoMove= params.autoMove? params.autoMove.toLowerCase() =="true"?true:false: false;
            console.log("autoMove", autoMove);

            // id auto diceroll then deduct 1 life and check is all life used then leave user from room and check for end game
            if(autoMove){
                let mypos = await _tab.getMyPosition(params.room, id);
                var checkLife = await _tab.getMyLife(params.room, id);
                let table= await getTable(params.room)
                 if (checkLife == 0) {
                    var life_event = {
                        type: 'room_including_me',
                        room: params.room,
                        name: 'life_deduct',
                        data: {
                            room: params.room,
                            position: myPos,
                        },
                    };
                    //leave table and pass turn to next player
                    var rez = await _tab.leave(params.room, id);
                    if (!rez.res) {
                        return {
                            callback: {
                                status: 0,
                                message: localization.ServerError,
                            },
                        };
                    } else {
                        if(table.no_of_players!=2){
                        var player_left = {

                                    type: 'room_including_me',
                                    room: params.room,
                                    name: 'playerLeft',
                                    delay: 1500,
                                    data: {
                                        room: params.room,
                                        position: rez.position,
                                    }
                                };
                                resObj.events.push(player_left);
                            }
                        
                        var checkOnlyPlayerLeft = await _tab.checkOnlyPlayerLeft(params.room);
                        console.log("check only player left", checkOnlyPlayerLeft);
                        // CheckIfOnlyPlayerLeft
                        if (checkOnlyPlayerLeft) {
                            // Check if EndGame Possible
                            var endGame = await _tab.isThisTheEnd(params.room);
                            if (endGame) {
                                // Update values in user wallets & table data [DB]
                                let tableD = await Table.findOne({
                                    room: params.room,
                                });
                                if (tableD) {
                                    for (let j = 0; j < endGame.length; j++) {
                                        for (let k = 0; k < tableD.players.length; k++) {
                                            if (endGame[j].id.toString() == tableD.players[k].id.toString()) {
                                                tableD.players[k].rank = endGame[j].rank;
                                                tableD.players[k].pl += endGame[j].amount;
                                            }
                                        }
                                    }
                                    tableD.game_completed_at = new Date().getTime();
                                    tableD
                                        .save()
                                        .then((d) => {
                                        })
                                        .catch((e) => {
                                        });
                                }
                                // Update values in user wallets & table data [DB]
                                let event = {
                                    type: 'room_including_me',
                                    room: params.room,
                                    delay: 2000,
                                    name: 'end_game',
                                    data: {
                                        room: params.room,
                                        game_data: endGame,
                                    },
                                };
                                resObj.events.push(event);
                                return resObj
                            }
                            // Else [!endGame]
                            else {
                                console.log("in make diceroll1")
                                let myPos = await _tab.getMyPosition(params.room, id);
                                //  SCRAP CURRENT DICES & PASS NEXT DICE_ROLL
                                await _tab.scrapTurn(params.room, myPos);
                                // DICE_ROLL TO NEXT
                                let nextPos = await _tab.getNextPosition(params.room, myPos);
                                await _tab.updateCurrentTurn(params.room, nextPos, 'roll', myPos);
                                let DICE_ROLLED = _tab.rollDice();
                                await _tab.diceRolled(params.room, nextPos, DICE_ROLLED,true);
                                let dices_rolled = await _tab.gePlayerDices(params.room, nextPos);
        
                                // SEND EVENT
                                let event = {
                                    type: 'room_including_me',
                                    room: params.room,
                                    delay: 800,
                                    name: 'make_diceroll',
                                    data: {
                                        room: params.room,
                                        position: nextPos,
                                        // tokens: await _tab.getTokens(params.room),
                                        dice: DICE_ROLLED,
                                        dices_rolled: dices_rolled,
                                    },
                                };
                                resObj.events.push(event);
                            }
                        } else {
                            // let mypos = await _tab.getMyPosition(params.room, id);
                            logger.info('My position::', mypos);
                            if (mypos != -1) {
                                let check = await _tab.isCurrentTurnMine(params.room, mypos);
                                if (check) {
                                    //  SCRAP CURRENT DICES & PASS NEXT DICE_ROLL
                                    await _tab.scrapTurn(params.room, mypos);
                                    // nextPosition find & add event dice_roll
                                    let nextPos = await _tab.getNextPosition(params.room, mypos);
                                    await _tab.updateCurrentTurn(params.room, nextPos, 'roll', mypos);
                                    let DICE_ROLLED = _tab.rollDice();
                                    await _tab.diceRolled(params.room, nextPos, DICE_ROLLED,true);
                                    let dices_rolled = await _tab.gePlayerDices(params.room, nextPos);
                                    let event = {
                                        type: 'room_including_me',
                                        room: params.room,
                                        delay: 800,
                                        name: 'make_diceroll',
                                        data: {
                                            room: params.room,
                                            position: nextPos,
                                            // tokens: await _tab.getTokens(params.room),
                                            dice: DICE_ROLLED,
                                            dices_rolled: dices_rolled,
                                        },
                                    };
                                    resObj.events.push(event);
                                }
                            }
                        }
                        return resObj;
                    }
                } 
                else{
                    await _tab.deductLife(params.room, id);
                    var life_event = {
                        type: 'room_including_me',
                        room: params.room,
                        name: 'life_deduct',
                        data: {
                            room: params.room,
                            position: myPos,
                        },
                    };
                    resObj.events.push(life_event);
                }
            }

            let diceVales = [];
            diceVales.push(params.dice_value)

            // if dice value is six than add six count and bonus counts to +1
            if (params.dice_value == 6) {
                console.log("in the params dice value 0................");
                await _tab.addBonus(params.room, id, 1);
                await _tab.addSix(params.room, id, 1);
            }

            // Check if move is possible
            var movePossibleExact = await _tab.isMovePossibleExact(params.dice_value,params.room,id,params.token_index);
            
            //if move is not possible (ex all token inside home and roll 3 so move is not possible)
            if (!movePossibleExact) {
                console.log('[NOT MOVE IMPOSSIBLE EXACT]');
                //if dice not six then scrap turn to opponent and give dice roll else give dice roll again to same player
                if (params.dice_value != 6) {
                    console.log('[DICE VALUE NOT SIX]');
                    //  SCRAP CURRENT DICES & PASS NEXT DICE_ROLL
                    await _tab.setSix(params.room, id);
                    console.log("set six...1")
                    await _tab.scrapTurn(params.room, myPos);
                    // DICE_ROLL TO NEXT
                    let nextPos =await _tab.getNextPosition(params.room, myPos);
                    await _tab.scrapTurn(params.room, nextPos);
                    await _tab.updateCurrentTurn(params.room, nextPos, 'roll', myPos);
                    let DICE_ROLLED = _tab.rollDice();
                    await _tab.diceRolled(params.room, nextPos, DICE_ROLLED,true);
                    let dices_rolled = await _tab.gePlayerDices(params.room, nextPos);
                    // SEND EVENT
                    let event = {
                        type: 'room_including_me',
                        room: params.room,
                        delay: 1500,
                        name: 'make_diceroll',
                        data: {
                            room: params.room,
                            position: nextPos,
                            // tokens: await _tab.getTokens(params.room),
                            dice: DICE_ROLLED,
                            dices_rolled: dices_rolled,
                        },
                    };
                    resObj.events.push(event);

                } else {
                    console.log('[DICE VALUE SIX]');
                    // Send 'roll' to same player
                    await _tab.updateCurrentTurn(params.room, myPos, 'roll', -1);
                    let DICE_ROLLED = await _tab.rollDice();
                    // console.log('[DICE VALUE SIX]', DICE_ROLLED);
                    await _tab.diceRolled(params.room, myPos, DICE_ROLLED, false);
                    let dices_rolled = await _tab.gePlayerDices(params.room, myPos,false);
                    // console.log('[DICE VALUE SIX]', dices_rolled, myPos);
                    // SEND EVENT
                    let event = {
                        type: 'room_including_me',
                        room: params.room,
                        delay: 1500,
                        name: 'make_diceroll',
                        data: {
                            room: params.room,
                            position: myPos,
                            // tokens: await _tab.getTokens(params.room),
                            dice: DICE_ROLLED,
                            dices_rolled: dices_rolled,
                        },
                    };

                    resObj.events.push(event);
                }
            } else {
                //move is possible
                console.log('[MOVE POSSIBLE EXACT]');
                let moveBonusCheck = false;
                var token_position = await _tab.makeMove(params.dice_value, params.room, id, params.token_index);
                let dices_rolled = await _tab.gePlayerDices(params.room, myPos);
                // send move_made event to unity
                let moveMadeEvent = {
                    type: 'room_including_me',
                    room: params.room,
                    name: 'move_made',
                    data: {
                        room: params.room,
                        player_index: myPos,
                        token_index: params.token_index,
                        dice_value: params.dice_value,
                        // dices_rolled: dices_rolled,
                    },
                };
                resObj.events.push(moveMadeEvent);
                var killed = false;
                // if CURRENT_POSITION == 56 (means pawn reach to destination)
                if (token_position == 56) {
                    console.log('[BEFORE HOME]');
                    // Add Bonus turn
                    await _tab.addBonus(params.room, id, 1);

                    // Check if all pawn reach to destination
                    const allHome = await _tab.allHome(params.room, id);
                    //if all home then give him win tag and rank
                    if (allHome) {
                        // Add TurnComplete Event
                        let turnCompleteEvent = {
                            type: 'room_including_me',
                            room: params.room,
                            delay: 2000,
                            name: 'complete_turn',
                            data: {
                                room: params.room,
                                rank: allHome.rank,
                                player_position: allHome.position,
                            },
                        };
                        resObj.events.push(turnCompleteEvent);

                        // Check if EndGame Possible
                        var checkOnlyPlayerLeft = await _tab.checkOnlyPlayerLeft(params.room);
                        console.log("check only player left", checkOnlyPlayerLeft);
                        if(checkOnlyPlayerLeft){
                        var endGame = await _tab.isThisTheEnd(params.room);
                        console.log("is this the end", endGame);
                        if (endGame) {
                            // Update values in user wallets & table data [DB]
                            var tableD = await Table.findOne({
                                room: params.room,
                            });

                            if (tableD) {
                                for (let j = 0; j < endGame.length; j++) {
                                    for (let k = 0; k < tableD.players.length; k++) {
                                        if (endGame[j].id.toString() == tableD.players[k].id.toString()) {
                                            tableD.players[k].rank = endGame[j].rank;
                                            tableD.players[k].pl += endGame[j].amount;
                                        }
                                    }
                                }

                                tableD.game_completed_at = new Date().getTime();

                                tableD
                                    .save()
                                    .then((d) => {
                                        // logger.info(d);
                                    })
                                    .catch((e) => {
                                        // logger.info('Error::', e);
                                    });
                            }

                            // Update values in user wallets & table data [DB]
                            let event = {
                                type: 'room_including_me',
                                room: params.room,
                                delay: 2000,
                                name: 'end_game',
                                data: {
                                    room: params.room,
                                    game_data: endGame,
                                },
                            };
                            resObj.events.push(event);
                        }
                        }
                        // Else [!endGame]
                        else {
                            //  SCRAP CURRENT DICES & PASS NEXT DICE_ROLL
                            await _tab.scrapTurn(params.room, myPos);
                            // DICE_ROLL TO NEXT
                            let nextPos = await _tab.getNextPosition(params.room, myPos);
                            await _tab.updateCurrentTurn(params.room, nextPos, 'roll', myPos);
                            let DICE_ROLLED = _tab.rollDice();
                            await _tab.diceRolled(params.room, nextPos, DICE_ROLLED,true);
                            let dices_rolled = await _tab.gePlayerDices(params.room, nextPos);
                            // SEND EVENT
                            let event = {
                                type: 'room_including_me',
                                room: params.room,
                                delay: 1500,
                                name: 'make_diceroll',
                                data: {
                                    room: params.room,
                                    position: nextPos,
                                    // tokens: await _tab.getTokens(params.room),
                                    dice: DICE_ROLLED,
                                    dices_rolled: dices_rolled,
                                },
                            };
                            resObj.events.push(event);
                        }
                    }
                    else {
                        moveBonusCheck = true;
                    }
                }
                else {
                    console.log('[BEFORE NOT HOME]');
                    // Check If Killing Possible (Kill & Get Tokens)
                    console.log("can i kill .........")
                    var canIKill = await _tab.canIKill(params.room, id, params.token_index, myPos);
                    if (canIKill) {
                        // Send Token Killed Event
                        let event = {
                            type: 'room_including_me',
                            room: params.room,
                            delay:(parseInt(params.dice_value) * 100) + ((canIKill[0].total_steps + 6) * 0.03* 1000),
                            name: 'token_killed',
                            data: {
                                room: params.room,
                                dead_tokens: canIKill,
                            },
                        };
                        resObj.events.push(event);

                        // Add Bonus as much as Killed Token Length
                        let sixCounts = await _tab.setSix(params.room, id);
                        await _tab.addBonus(params.room, id, canIKill.length);

                        moveBonusCheck = true;
                        killed = true;
                    }
                    else {
                        moveBonusCheck = true;
                    }
                }
                console.log("id move bonus check",moveBonusCheck);
                if (moveBonusCheck) {
                    // check bonus turn is remaining
                    let movePossible = await _tab.isMovePossible(params.room, id);
                    // logger.info('movePossible >>', movePossible);

                    let timer = 1500;
                    if (killed) timer = 4000;

                    // If Move Possible then give him make move
                    if (movePossible) {
                        console.log("in move event!!!!!");
                        //  MAKE_MOVE TO ME
                        await _tab.updateCurrentTurn(params.room, myPos, 'move', -1);
                        let dices_rolled = await _tab.gePlayerDices(params.room, myPos);
                        let movable_token= await _tab.getMovableTokenCount(params.room, id)

                        let event = {
                            type: 'room_including_me',
                            room: params.room,
                            delay: timer,
                            name: 'make_move',
                            data: {
                                room: params.room,
                                position: myPos,
                                dices_rolled: dices_rolled,
                                // auto_move:movable_token==1?1:0
                            },
                        };
                        resObj.events.push(event);
                    }
                    // Else give roll dice
                    else {
                        console.log("in the SCRAP TURNB");
                        await _tab.scrapTurn(params.room, myPos);

                        // Check If Bonus Pending
                        let pendingBonus = await _tab.getBonus(params.room, id);
                        if (pendingBonus > 0) {
                            console.log("in the SCRAP TURNB 11");
                            await _tab.useBonus(params.room, id);
                            await _tab.updateCurrentTurn(params.room, myPos, 'roll', -1);
                            let DICE_ROLLED = await _tab.rollDice();
                            await _tab.diceRolled(params.room, myPos, DICE_ROLLED,false);
                            let dices_rolled = await _tab.gePlayerDices(params.room, myPos);
                            let event = {
                                type: 'room_including_me',
                                room: params.room,
                                // delay: baseTimer*config.BASE_TIMER,
                                delay:timer,
                                name: 'make_diceroll',
                                data: {
                                    room: params.room,
                                    position: myPos,
                                    // tokens: await _tab.getTokens(params.room),
                                    dice: DICE_ROLLED,
                                    dices_rolled: dices_rolled,
                                },
                            };
                            resObj.events.push(event);
                        }
                        else {
                            console.log("in the SCRAP TURNB 22");
                            //  SCRAP CURRENT DICES & PASS NEXT DICE_ROLL
                            await _tab.setSix(params.room, id);
                            console.log("set six...4")
                            await _tab.scrapTurn(params.room, myPos);
                            let nextPos = await _tab.getNextPosition(params.room, myPos);
                            await _tab.updateCurrentTurn(params.room, nextPos, 'roll', myPos);
                            let DICE_ROLLED = await _tab.rollDice();
                            await _tab.diceRolled(params.room, nextPos, DICE_ROLLED,true);
                            let dices_rolled = await _tab.gePlayerDices(params.room, nextPos);
                            // SEND EVENT
                            let event = {
                                type: 'room_including_me',
                                room: params.room,
                                // delay: baseTimer*config.BASE_TIMER,
                                delay:timer,
                                name: 'make_diceroll',
                                data: {
                                    room: params.room,
                                    position: nextPos,
                                    // tokens: await _tab.getTokens(params.room),
                                    dice: DICE_ROLLED,
                                    dices_rolled: dices_rolled,
                                },
                            };
                            resObj.events.push(event);
                        }
                    }
                }
            }
            console.log('[MOVE_MADE]', JSON.stringify(resObj));
            return resObj;
        } catch (err) {
        }
    },

    getMovableToken:async function(room,id){
        return await _tab.getMovableToken(room, id)
    },
    getMovableTokenCount:async function(room,id){
        return await _tab.getMovableTokenCount(room, id)
    },
    isAllAtInitial:async function(room,id){
        return await _tab.isAllAtInitial(room,id)
    },

    isCurrentPlayerLeaving:async function(room, id){
        let table = await getTable(room)
        console.log("curent turn", table, room ,id, table.users[parseInt(table.current_turn)].id);
        if(table.current_turn!=-1){
            if(table.users[table.current_turn].id==id){

                var resObj = { callback: { status: 1, message: localization.success }, events: [] }
                let mypos = await _tab.getMyPosition(room, id);
                await _tab.scrapTurn(room, id);
                // DICE_ROLL TO NEXT
                let nextPos = await _tab.getNextPosition(room, mypos);
                console.log("next pos!!!!", nextPos);
                await _tab.updateCurrentTurn(room, nextPos, 'roll', id);
                let DICE_ROLLED = _tab.rollDice();
                await _tab.diceRolled(room, nextPos, DICE_ROLLED,true);
                let dices_rolled = await _tab.gePlayerDices(room, nextPos);

                // SEND EVENT
                let event = {
                    type: 'room_including_me',
                    room: room,
                    delay: 800,
                    name: 'make_diceroll',
                    data: {
                        room: room,
                        position: nextPos,
                        // tokens: await _tab.getTokens(room),
                        dice: DICE_ROLLED,
                        dices_rolled: dices_rolled,
                    },
                };
                console.log("event teday", event);
                resObj.events.push(event);
                return resObj
            }
        }
    },

    // Quit Game / Leave Table
    leaveTable: async function (params, id) {
        logger.info('LeaveRequest Request IN', params, id);
        if (!params)
            return {
                callback: {
                    status: 0,
                    message: localization.missingParamError,
                },
            };

        if (!params.room)
            return {
                callback: {
                    status: 0,
                    message: localization.missingParamError,
                },
            };

        var tableD = await Table.findOne({
            room: params.room,
        });
        if (!tableD)
            return {
                callback: {
                    status: 0,
                    message: localization.tableDoesNotExist,
                },
            };

        var rez = await _tab.leave(params.room, id);
        console.log('LEAVE RES', rez);

        // logger.info('REZ', rez);
        if (!rez.res) {
            return {
                callback: {
                    status: 0,
                    message: localization.ServerError,
                },
            };
        } else {
            var rez_finalObj = {
                callback: {
                    status: 1,
                    message: localization.success,
                },
                events: [
                    {
                        type: 'room_excluding_me',
                        room: params.room,
                        name: 'playerLeft',
                        data: {
                            room: params.room,
                            position: rez.position,
                        },
                    },
                ],
            };

            var checkOnlyPlayerLeft = await _tab.checkOnlyPlayerLeft(params.room);
            console.log("chec only player left", checkOnlyPlayerLeft)
            // CheckIfOnlyPlayerLeft
            if (checkOnlyPlayerLeft) {
                // Check if EndGame Possible
                var endGame = await _tab.isThisTheEnd(params.room);
                // console.log('endGame::', endGame);
                if (endGame) {
                    // Update values in user wallets & table data [DB]
                    let tableD = await Table.findOne({
                        room: params.room,
                    });

                    if (tableD) {
                        for (let j = 0; j < endGame.length; j++) {
                            for (let k = 0; k < tableD.players.length; k++) {
                                if (endGame[j].id.toString() == tableD.players[k].id.toString()) {
                                    tableD.players[k].rank = endGame[j].rank;
                                    tableD.players[k].pl += parseInt(endGame[j].amount);
                                }
                            }
                        }

                        tableD.game_completed_at = new Date().getTime();
                        console.log('table d',tableD);

                        await tableD
                            .save()
                            .then((d) => {
                                console.log("saves",d);
                            })
                            .catch((e) => {
                                console.log('Error::', e);
                            });
                    }

                    // Update values in user wallets & table data [DB]
                    let event = {
                        type: 'room_including_me',
                        room: params.room,
                        delay: 2000,
                        name: 'end_game',
                        data: {
                            room: params.room,
                            game_data: endGame,
                        },
                    };
                    rez_finalObj.events.push(event);
                }
                // Else [!endGame]
                else {
                    let myPos = await _tab.getMyPosition(params.room, id);
                    //  SCRAP CURRENT DICES & PASS NEXT DICE_ROLL
                    await _tab.scrapTurn(params.room, myPos);
                    // DICE_ROLL TO NEXT
                    let nextPos = await _tab.getNextPosition(params.room, myPos);
                    await _tab.updateCurrentTurn(params.room, nextPos, 'roll', myPos);
                    let DICE_ROLLED = _tab.rollDice();
                    await _tab.diceRolled(params.room, nextPos, DICE_ROLLED,true);
                    let dices_rolled = await _tab.gePlayerDices(params.room, nextPos);
                    // SEND EVENT
                    let event = {
                        type: 'room_including_me',
                        room: params.room,
                        delay: 800,
                        name: 'make_diceroll',
                        data: {
                            room: params.room,
                            position: nextPos,
                            // tokens: await _tab.getTokens(params.room),
                            dices_rolled: dices_rolled,
                            dice: DICE_ROLLED,
                        },
                    };
                    rez_finalObj.events.push(event);
                }
            } else {
                let mypos = await _tab.getMyPosition(params.room, id);
                logger.info('My position::', mypos);

                if (mypos != -1) {
                    let check = await _tab.isCurrentTurnMine(params.room, mypos);
                    if (check) {
                        //  SCRAP CURRENT DICES & PASS NEXT DICE_ROLL
                        await _tab.scrapTurn(params.room, mypos);
                        // nextPosition find & add event dice_roll
                        let nextPos = await _tab.getNextPosition(params.room, mypos);
                        await _tab.updateCurrentTurn(params.room, nextPos, 'roll', mypos);
                        let DICE_ROLLED = _tab.rollDice();
                        await _tab.diceRolled(params.room, nextPos, DICE_ROLLED,true);
                        let dices_rolled = await _tab.gePlayerDices(params.room, nextPos);
                        let event = {
                            type: 'room_including_me',
                            room: params.room,
                            delay: 800,
                            name: 'make_diceroll',
                            data: {
                                room: params.room,
                                position: nextPos,
                                // tokens: await _tab.getTokens(params.room),
                                dice: DICE_ROLLED,
                                dices_rolled: dices_rolled,
                            },
                        };

                        rez_finalObj.events.push(event);
                    }
                }
            }
            return rez_finalObj;
        }
    },

    //Skip Turn
    skipTurn: async function (params, id) {
        console.log('Skip Turn Request', params);
        if (!params)
            return {
                callback: {
                    status: 0,
                    message: localization.missingParamError,
                },
            };
        if (!params.room)
            return {
                callback: {
                    status: 0,
                    message: localization.missingParamError,
                },
            };

        var mypos = await _tab.getMyPosition(params.room, id);
        console.log('My position::', mypos);

        if (mypos != -1) {
            var check = await _tab.isCurrentTurnMine(params.room, mypos);

            if (check) {
                var checkLife = await _tab.getMyLife(params.room, id);

                // logger.info('Current Life::', checkLife);

                if (checkLife == 0) {

                    var life_event = {
                        type: 'room_including_me',
                        room: params.room,
                        name: 'life_deduct',
                        data: {
                            room: params.room,
                            position: mypos,
                        },
                    };
                    //leave table and pass turn to next player
                    var rez = await _tab.leave(params.room, id);
                    // logger.info('REZ', rez);
                    if (!rez.res) {
                        return {
                            callback: {
                                status: 0,
                                message: localization.ServerError,
                            },
                        };
                    } else {
                        var rez_finalObj = {
                            callback: {
                                status: 2,
                                message: localization.success,
                            },
                            events: [
                                {
                                    type: 'room_including_me',
                                    room: params.room,
                                    name: 'playerLeft',
                                    delay: 1500,
                                    data: {
                                        room: params.room,
                                        position: rez.position,
                                    },
                                },
                            ],
                        };

                        var checkOnlyPlayerLeft = await _tab.checkOnlyPlayerLeft(params.room);
                        console.log("check only player left", checkOnlyPlayerLeft);
                        // CheckIfOnlyPlayerLeft
                        if (checkOnlyPlayerLeft) {
                            // Check if EndGame Possible
                            var endGame = await _tab.isThisTheEnd(params.room);
                            if (endGame) {
                                // Update values in user wallets & table data [DB]
                                let tableD = await Table.findOne({
                                    room: params.room,
                                });

                                if (tableD) {
                                    for (let j = 0; j < endGame.length; j++) {
                                        for (let k = 0; k < tableD.players.length; k++) {
                                            if (endGame[j].id.toString() == tableD.players[k].id.toString()) {
                                                tableD.players[k].rank = endGame[j].rank;
                                                tableD.players[k].pl += endGame[j].amount;
                                            }
                                        }
                                    }

                                    tableD.game_completed_at = new Date().getTime();

                                    tableD
                                        .save()
                                        .then((d) => {
                                            // logger.info(d);
                                        })
                                        .catch((e) => {
                                            // logger.info('Error::', e);
                                        });
                                }

                                // Update values in user wallets & table data [DB]
                                let event = {
                                    type: 'room_including_me',
                                    room: params.room,
                                    delay: 2000,
                                    name: 'end_game',
                                    data: {
                                        room: params.room,
                                        game_data: endGame,
                                    },
                                };
                                rez_finalObj.events.push(event);
                            }
                            // Else [!endGame]
                            else {
                                console.log("in make diceroll1")
                                let myPos = await _tab.getMyPosition(params.room, id);
                                //  SCRAP CURRENT DICES & PASS NEXT DICE_ROLL
                                await _tab.scrapTurn(params.room, myPos);
                                // DICE_ROLL TO NEXT
                                let nextPos = await _tab.getNextPosition(params.room, myPos);
                                await _tab.updateCurrentTurn(params.room, nextPos, 'roll', myPos);
                                let DICE_ROLLED = _tab.rollDice();
                                await _tab.diceRolled(params.room, nextPos, DICE_ROLLED,true);
                                let dices_rolled = await _tab.gePlayerDices(params.room, nextPos);
        
                                // SEND EVENT
                                let event = {
                                    type: 'room_including_me',
                                    room: params.room,
                                    delay: 800,
                                    name: 'make_diceroll',
                                    data: {
                                        room: params.room,
                                        position: nextPos,
                                        // tokens: await _tab.getTokens(params.room),
                                        dice: DICE_ROLLED,
                                        dices_rolled: dices_rolled,
                                    },
                                };
                                rez_finalObj.events.push(event);
                            }
                        } else {
                            let mypos = await _tab.getMyPosition(params.room, id);
                            logger.info('My position::', mypos);

                            if (mypos != -1) {
                                let check = await _tab.isCurrentTurnMine(params.room, mypos);
                                if (check) {
                                    //  SCRAP CURRENT DICES & PASS NEXT DICE_ROLL
                                    await _tab.scrapTurn(params.room, mypos);
                                    // nextPosition find & add event dice_roll
                                    let nextPos = await _tab.getNextPosition(params.room, mypos);
                                    await _tab.updateCurrentTurn(params.room, nextPos, 'roll', mypos);
                                    let DICE_ROLLED = _tab.rollDice();
                                    await _tab.diceRolled(params.room, nextPos, DICE_ROLLED,true);
                                    let dices_rolled = await _tab.gePlayerDices(params.room, nextPos);
                                    let event = {
                                        type: 'room_including_me',
                                        room: params.room,
                                        delay: 800,
                                        name: 'make_diceroll',
                                        data: {
                                            room: params.room,
                                            position: nextPos,
                                            // tokens: await _tab.getTokens(params.room),
                                            dice: DICE_ROLLED,
                                            dices_rolled: dices_rolled,
                                        },
                                    };

                                    rez_finalObj.events.push(event);
                                }
                            }
                        }

                        return rez_finalObj;
                    }
                } else {
                    var resObj = {
                        callback: {
                            status: 1,
                            message: localization.success,
                        },
                        events: [],
                    };

                    await _tab.deductLife(params.room, id);
                    var life_event = {
                        type: 'room_including_me',
                        room: params.room,
                        name: 'life_deduct',
                        data: {
                            room: params.room,
                            position: mypos,
                        },
                    };
                    resObj.events.push(life_event);

                    //  SCRAP CURRENT DICES & PASS NEXT DICE_ROLL
                    console.log("in scrap turn");
                    await _tab.scrapTurn(params.room, mypos);
                    console.log("in scrap turn1");
                    // nextPosition find & add event dice_roll
                    let nextPos = await _tab.getNextPosition(params.room, mypos);
                    console.log("in scrap turn2", nextPos);
                    await _tab.updateCurrentTurn(params.room, nextPos, 'roll', mypos);
                    console.log("in scrap turn3");
                    let DICE_ROLLED =_tab.rollDice();
                    console.log("in scrap turn5", DICE_ROLLED);
                    await _tab.diceRolled(params.room, nextPos, DICE_ROLLED,true);
                    let dices_rolled = await _tab.gePlayerDices(params.room, nextPos);
                    console.log("in scrap turn4", dices_rolled);
                    let event = {
                        type: 'room_including_me',
                        room: params.room,
                        delay: 800,
                        name: 'make_diceroll',
                        data: {
                            room: params.room,
                            position: nextPos,
                            // tokens: await _tab.getTokens(params.room),
                            dice: DICE_ROLLED,
                            dices_rolled: dices_rolled,
                        },
                    };

                    resObj.events.push(event);

                    return resObj;
                }
            } else {
                return {
                    callback: {
                        status: 0,
                        message: localization.NotYourMoveError,
                    },
                };
            }
        } else {
            return {
                callback: {
                    status: 0,
                    message: localization.ServerError,
                },
            };
        }
    },

    //Start Game If Possible
    startIfPossible: async function (params) {
        // logger.info('StartIfPossible request IN', params);

        if (!params) return false;

        if (!params.room) return false;

        var start = await _tab.startGame(params.room);
        // logger.info('AFTER START ==>');

        let tableD = await Table.findOne({ room: params.room });
        if (tableD) {
            tableD.game_started_at = new Date().getTime();
            await tableD.save();
        }

        return start;
    },

    // Deduct Money
    async deductMoney(table) {
        console.log("Deduct Money Request >>", table);
    
        if (!table) return Promise.resolve(false);
    
        var room = await getTable(table.room);
        console.log("tabel is", room);
        let data={  "status": "MATCH_FOUND",
                    "room": `${room.room}`, 
                    "amount":`${room.win_amount}`,
                    "contest_id":`${room.contest_id}`,
                    "players":[]
                  };
    
        for (let i = 0; i < table.users.length; i++) {
            if(table.users[i].id!=""){
          data.players.push(table.users[i].id)
            }
        }
        
    
        let deductMoney = await rest_api.deductMoney(data);
        console.log("Deduct money", deductMoney)
    
        if (!deductMoney) {
          return false;
        }
        // await tableD.save();
        console.log("deductMomey res");
        return Promise.resolve(true);
    },

    // delete room 
    abortGame: async function (table) {
        let nw = await Table.findOneAndUpdate(
            {
                room: table.room,
            },
            {
                $set: {
                    game_completed_at: new Date().getTime(),
                    players: [],
                },
            },
            {
                new: true,
            }
        );

        console.log('NW DONE', nw);

        await _tab.abortGame(table.room);
    },

    //Send Emoji
    sendEmoji: async function (params) {
        // logger.info('Send Emoji Request', params);

        if (!params)
            return {
                callback: {
                    status: 0,
                    message: localization.missingParamError,
                },
            };
        if (!params.room)
            return {
                callback: {
                    status: 0,
                    message: localization.missingParamError,
                },
            };

        if (!params.position)
            return {
                callback: {
                    status: 0,
                    message: localization.missingParamError,
                },
            };

        if (!params.emoji_index)
            return {
                callback: {
                    status: 0,
                    message: localization.missingParamError,
                },
            };

        let event = {
            type: 'room_excluding_me',
            room: params.room,
            name: 'received_emoji',
            data: {
                room: params.room,
                position: params.position,
                emoji_index: params.emoji_index,
            },
        };

        var resObj = {
            callback: {
                status: 1,
                message: localization.success,
            },
            events: [],
        };

        resObj.events.push(event);

        return resObj;
    },

    //Check Tabel Exists
    istableExists: async function (params) {
        // logger.info('Check Tabel Exists Request >> ', params);
        if (!params) {
            // logger.info('missingParamError');
            return false;
        }
        if (!params.room) {
            // logger.info('missingParamError');
            return false;
        }

        var tabelCheck = await _tab.checkTableExists(params.room);
        // logger.info('Table Exists', tabelCheck);
        return tabelCheck;
    },

    //get player id by position
    getMyIdByPossition: async function (params, id) {
        if (!params) {
            return false;
        }
        if (!params.room) {
            return false;
        }

        var user_id = await _tab.getMyIdByPosition(params.room, id);
        return user_id;
    },

    //get end game data
    getEndgameData: async function(room){
        var tableD = await table.findOne({
            room:room
        });
        if (!tableD){ return {status:0, data:{}}}
        console.log(tableD)
        let rank=[]

        for(var i =0;i<tableD.players.length;i++){
            rank.push({
                        // "player_index": 0,
                        "name":tableD.players[i].name,
                        "profile_pic": tableD.players[i].profile_pic,
                        "rank": tableD.players[i].rank,
                        "amount": tableD.players[i].pl,
                        "id": tableD.players[i].id,
                        "token": tableD.players[i].token
                    })
        }

        let data ={"room": tableD.room,
        "game_data": rank
        }
        return {status:1, data}
    },

    // resonnect user if already plaing
    reconnectIfPlaying: async function (id) {
        console.log("id", id)

        var alreadyPlaying = await _tab.alreadyPlayingTable(id);

        if (alreadyPlaying.status == 1) {
            var tab = await Table.findOne({ room: alreadyPlaying.table.room, 'players.id': id });
            if (!tab) {
                // FIX_2407 : ALREADY PLAYING
                console.log('DESTROY', alreadyPlaying.table.room);
                _tab.abortGame(alreadyPlaying.table.room);
                return {
                    status: 0,
                };
            } else return alreadyPlaying;
        } else {
            return alreadyPlaying;
        }

        // logger.info('User Playing On Table', alreadyPlaying);
    },

    //join punlic table
    join_public: async function (params, myId, io) {
        console.log('User id', myId, params,params.token, process.env.NODE_ENV, process.env.NODE_ENV == "local");
        params = _.pick(params, ['no_of_players', 'room_fee', 'token', 'user_name','user_id', 'profile_pic', 'contest_id', 'win_amount']);

        if (!params)
            return {
                callback: {
                    status: 0,
                    message: localization.invalidRequestParams,
                },
            };
        let us
        if(process.env.NODE_ENV=="live"){
            us={user_name: params.user_name,userId:params.user_id,profile_pic:params.profile_pic }
        }else{
            us={user_name: params.user_name,userId:params.user_id,profile_pic:params.profile_pic }
        }        

        console.log("user", us);
        if (!us) {
            console.log('Deactivated');
            return {callback: {status: 0,message: localization.ServerError}}
        }
        var alreadyPlaying;
        // if(!fresh_start){
        alreadyPlaying = await _tab.alreadyPlaying(us.userId);
        // }
        // else{
        //     console.log("in else,,");
        //     alreadyPlaying=false
        // }
        console.log("res of already playing", alreadyPlaying)

        if (alreadyPlaying) {
            return {
                callback: {
                    status: 0,
                    message: localization.alreadyPlaying,
                },
            };
        }

        if (_.isEmpty(params.no_of_players) || _.isEmpty(params.room_fee)) {
            return {
                callback: {
                    status: 0,
                    message: localization.invalidRequestParams,
                },
            };
        } else {
            // logger.info('PASSED');
        }

        var checkPubRes = await _tab.checkPublicTable(params.room_fee, params.no_of_players, params.contest_id);
        var isAnyTabelEmpty = checkPubRes ? checkPubRes.room : false;
        var timerStart = 120;
        var tableX;

        //if ant table empty then join user in that table
        if (!isAnyTabelEmpty) {
            console.log('No Public Table Found');

            //Create Tabel
            var room = await Service.randomNumber(6);
            var data;
            while (true) {
                data = await Table.find({
                    room: room,
                });

                if (data.length > 0) room = await Service.randomNumber(6);
                else break;
            }

            params.room = room;
            params.room_type = 'PUB';
            params.created_by = myId;
            params.token= us.userId
            params.created_at = new Date().getTime();

            var table = new Table(params);
            tableX = await table.save();

            if (!tableX) {
                return {
                    callback: {
                        status: 0,
                        message: localization.ServerError,
                    },
                };
            }

            var room_code = await _tab.newCreateTable(tableX);
            let interval 
            //function is use for match making timer it will wait for 60 sec after thet check all players joind then do nothing else abort game as no other player join room
            setTimeout(async function () {
                clearInterval(interval)
                var tableD = await Table.findOne({
                    room:room
                });
                console.log("tableD", tableD);
                if (tableD && tableD.players.length < tableD.no_of_players) {        
                    console.log("No other playe joined")
                    let data = {
                        token: params.token,
                        room: tableD.room,
                        gameNotStarted: 'true'
                    }
                    io.to(tableD.room).emit('game_aborted',{room:tableD.room});
                    await removeTable(tableD.room)
                }

            }, 61000)

            //it will send match_making_timer every second (remaining time from 60 sec) 
            interval =setInterval(async function () {
                let table= await getTable(room);
                // console.log("table", table);
                let match_timer=60-Math.floor((parseInt(new Date().getTime()) - parseInt(table.created_at))/1000)
                io.to(table.room).emit("match_making_timer",{room:room,timer: match_timer})
                console.log("match_timer", match_timer);
                console.log(match_timer<=0,table.game_started_at,  table.game_started_at!=-1);
                if(match_timer<=0 || table.game_started_at!=-1){
                    console.log("match_timer_completed");
                    clearInterval(this)
                }

            }, 1000);

            if (!room_code) {return {callback: {status: 0,message: localization.ServerError}}}
            isAnyTabelEmpty = room_code;
        } else {
            // create new table
            timerStart = checkPubRes.timerStart;

            tableX = await Table.findOne({
                room: isAnyTabelEmpty,
            });
            if (!tableX) {
                return {callback: {status: 0,message: localization.ServerError}};
            }
        }

        let optional = 0;
        var seatOnTable = await _tab.seatOnTable(isAnyTabelEmpty, us, optional);
        // add user on user arry (in room)
        if (seatOnTable) {
            var callbackRes = {
                status: 1,
                message: 'Done',
                table: seatOnTable.table,
                position: seatOnTable.pos,
                timerStart: timerStart,
            };

            var player = {
                id: us.userId,
                name: us.user_name,
                profile_pic:us.profile_pic
            };

            let flag = false;

            for (let i = 0; i < tableX.players.length; i++) {
                if (tableX.players[i].id.toString() == player.id.toString()) {
                    tableX.players[i] = player;
                    flag = true;
                    break;
                }
            }

            //Save Player to DB
            if (!flag) tableX.players.push(player);

            tableX.created_at = new Date().getTime();
            console.log("table x", tableX)

            await tableX.save();

            // logger.info('CALLBACK RES', JSON.stringify(callbackRes, undefined, 2));
            return {
                callback: callbackRes,
                events: [
                    {
                        type: 'room_excluding_me',
                        room: isAnyTabelEmpty,
                        name: 'playerJoin',
                        data: {
                            room: isAnyTabelEmpty,
                            name: us.user_name,
                            profile: us.profile_pic,
                            position: seatOnTable.pos,
                        },
                    },
                ],
            };
        } else {
            return {
                callback: {
                    status: 0,
                    message: 'Error joining game, please try again',
                },
            };
        }
    },
};
