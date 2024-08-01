const config = require('./../../config');
var tableObject = require('./tableObject');
var logger = require('../../api/service/logger');
const { getTableFromUser, getPublicTables, canSeat, saveTable, getTable, addUserOnTable, updateTable, updateUser, removeRoomFromSet, freeUser, removeTable } = require('../../redis/service/socket');
const _ = require('lodash');
const rest_api = require('../../api/rest_api');
class _Tables {
    constructor() {
        this.tables = tableObject;
    }

    //function use for create new table 
    newCreateTable = async (table) => {
        const tableData = _.pick(table, [
            'room',
            'room_type',
            'created_by',
            'created_at',
            'room_fee',
            'no_of_players',
            'no_of_winners',
            'contest_id',
            'win_amount'
        ]);
        const room = await saveTable(tableData);
        return Promise.resolve(room);
    };

    // Check Seat Available or not 
    checkSeatAvailable(room) {
        var count = 0;
        var noPlayers = 0;
        // logger.info('ROOM', room);
        for (var i = 0; i < this.tables.length; i++) {
            // logger.info('In loop---->', this.tables[i].room);
            if (this.tables[i].room == room) {
                noPlayers = this.tables[i].no_of_players;
                for (var pl = 0; pl < 4; pl++) {
                    if (this.tables[i].users[pl] && this.tables[i].users[pl].is_active) {
                        count++;
                    }
                }

                break;
            }
        }
        // logger.info('Count-->', count);
        // logger.info('noPlayers-->', noPlayers);

        let current_time = new Date().getTime();
        let time_diff = (current_time - (this.tables[i] ? this.tables[i].created_at : 0)) / 1000;

        return { flag: count < noPlayers, timerStart: 240 - time_diff };
    }

    // check table is available or not
    checkPublicTable = async (room_fee, no_of_players, contest_id) => {
        const tables = await getPublicTables(room_fee, no_of_players, contest_id);
        for (let i = 0; i < tables.length; i++) {
            if(tables[i].game_started_at==-1){
                let canSeatOnTable = canSeat(tables[i]);
                if (canSeatOnTable.flag) return Promise.resolve(_.pick(canSeatOnTable, ['room', 'timerStart']));
            }
        }
        return Promise.resolve(false);
    };

    //Check Online Player In Public Game
    playersInPublic() {
        var count = 0;
        for (var i = 0; i < this.tables.length; i++) {
            if (this.tables[i].room_type == 'PUB') {
                for (var pl = 0; pl < 4; pl++) {
                    if (this.tables[i].users[pl] && this.tables[i].users[pl].is_active) {
                        count++;
                    }
                }
            }
        }

        return count;
    }

    // check table is exist on redis or not
    checkTableExists = async (room) => {
        const table = await getTable(room);
        // console.log('checkTableExists', table);
        if (!table) return Promise.resolve({ status: false });
        return Promise.resolve({
            status: true,
            start_at: parseInt(table.turn_start_at),
            current_turn: table.current_turn,
            table
        });
    };

    // add user on table user array
    seatOnTable = async (room, user) => {
        const table = await getTable(room);
        console.log('TABLE WHERE seatOnTable', JSON.stringify(table, undefined, 2));
        if (!table) return Promise.resolve(false);
        let canSeatOnTable = canSeat(table);
        // console.log('TABLE WHERE seatOnTable', JSON.stringify(table, undefined, 2));
        if (!canSeatOnTable.flag) return Promise.resolve(false);
        let pos = -1;
        if (!table.users[0].is_active) pos = 0;
        else if (!table.users[2].is_active) pos = 2;
        else if (!table.users[1].is_active) pos = 1;
        else if (!table.users[3].is_active) pos = 3;
        user = _.pick(user, ['userId', 'user_name', 'profile_pic','token']);
        user.is_active = true;
        user.life = config.PLAYER_LIFES;
        user.six_counts= 0
        user.tokens = [-1,-1,-1,-1];
        if(user.user_name=="test2"){
            user.tokens=[-1,-1,-1,-1]
        }
        const updatedTable = await addUserOnTable(room, pos, user);
        return Promise.resolve({ table: updatedTable, pos });
    };

    //check user is alreday playing or not
    alreadyPlaying = async (user_id) => {
        const table = await getTableFromUser(user_id);
        if (!table) return Promise.resolve(false);
        const response = table.users.reduce(
            (prev, user) => prev || (user.id.toString() == user_id.toString() && !user.is_left),
            false
        );
        return Promise.resolve(response);
    };
    
    // find user is playing on any table
    alreadyPlayingTable = async (id) => {
        const table = await getTableFromUser(id);
        if (!table) return Promise.resolve({ status: 0 });
        console.log("table found", table)
    
        const me_on_table = table.users.find((user) => {console.log(user.id, id, user.id==id);if(user.id == id && !user.is_left){return true}});
        if (!me_on_table) return Promise.resolve({ status: 0 });
    
        var curr_ = new Date().getTime();
        console.log("in curr ", curr_,  table.turn_start_at);
        var diff = (curr_ - table.turn_start_at) / 1000;
        console.log("difff", diff);
        var diff_ = (curr_ - table.created_at) / 1000;
        console.log("diff_", diff_, 30 - diff);

        console.log('[alreadyPlayingTable]', curr_, table.turn_start_at, 30 - diff);
        var rez = {
            status: 1,
            table,
            turn_start_at: 30 - diff,
            timerStart: table.room_type == 'PUB' ? 120 - diff_ : 240 - diff_,
            game_started: !(table.turn_start_at == 0),
            // current_turn: table.current_turn,
            current_turn_type:  table.current_turn_type,
            position: me_on_table.position,
            dices_rolled: table.users[table.current_turn] ? table.users[table.current_turn].dices_rolled : [],
        };
        return rez;
    }

    // find token position of user from user id and room code
    getTokRoom(room, id) {
        for (var i = 0; i < this.tables.length; i++) {
            if (this.tables[i].room == room) {
                for (var pl = 0; pl < this.tables[i].users.length; pl++) {
                    if (this.tables[i].users[pl].id) {
                        if (
                            this.tables[i].users[pl].id.toString() == id.toString() &&
                            !this.tables[i].users[pl].is_left
                        ) {
                            // logger.info('You are playing on this table', this.tables[i]);

                            var curr_ = new Date().getTime();

                            var rez = {
                                status: 1,
                                tokens: this.tables[i].users.map((user) => {
                                    return {
                                        user_id: user.id,
                                        tokens: user.tokens,
                                    };
                                }),
                            };
                            return rez;
                        }
                    }
                }
            }
        }
        var rez = {
            status: 0,
        };
        return rez;
    }

    // leave user form room if playing
    leaveIfPlaying(id) {
        // logger.info('AlreadyPlaying Started >>', id);
        for (var i = 0; i < this.tables.length; i++) {
            for (var pl = 0; pl < this.tables[i].users.length; pl++) {
                if (this.tables[i].users[pl].id) {
                    if (this.tables[i].users[pl].id.toString() == id.toString()) {
                        // logger.info('You are playing on this table', this.tables[i]);
                        return this.tables[i].room;
                    }
                }
            }
        }
        return false;
    }

    // check rank is occupied if not then add rank of user
    isRankOccupied = (table, rank) => table.users.some((user) => {
        console.log("in is rank occupied???", user.rank , rank, user.rank == rank);
        return user.rank == rank});

    //leave user from table
    leave = async (room, user_id) => {
        const table = await getTable(room);
        if (!table) return Promise.resolve({ res: false });
        console.log('TABLE WHERE leave', user_id, JSON.stringify(table, undefined, 2));
        const user = table.users.find((user) => user.id == user_id && !user.is_left);
        if (!user) return Promise.resolve({ res: false });
        await freeUser(user_id);
    
        if (table.turn_start_at == 0) {
            const playersJoined = table.users.reduce((prev, user) => (user.is_active ? prev + 1 : prev), 0);
            // console.log('playersJoined', playersJoined);
            if (playersJoined == 1) {
                await removeTable(room);
            } else {
                user.id = '';
                user.numeric_id = '';
                user.name = '';
                user.profile_pic = '';
                user.is_active = false;
                user.is_done = false;
                user.is_left = false;
                user.rank = 0;
                user.life = 0;
                user.dices_rolled = [];
                user.bonus_dice = 0;
                user.tokens = [-1, -1, -1, -1];
                await updateUser(table.room, user.position, user);
            }
            return Promise.resolve({
                res: false,
                flag: 1,
                remove: playersJoined == 1,
            });
        }
    
        if (!user.is_done) {
            user.is_left = true;
            user.is_active= false;
            user.is_done = true;
            let rank = table.no_of_players;
            while (this.isRankOccupied(table, rank) || rank == 1) rank--;
    
            user.rank = rank;
            table.players_done += 1;
    
            await updateUser(table.room, user.position, user);
            await updateTable(table.room, table);
            return Promise.resolve({
                res: true,
                position: user.position,
                rank: rank,
            });
        }
    
        user.is_left = true;
        await updateUser(table.room, user.position, user);
        return Promise.resolve({
            res: true,
            position: user.position,
            rank: user.rank,
        });
    };

    //check leave is possible then leve room
    leaveIf(room, id) {
        for (var i = 0; i < this.tables.length; i++) {
            if (this.tables[i].room == room) {
                for (var pl = 0; pl < this.tables[i].users.length; pl++) {
                    if (this.tables[i].users[pl].id == id) {

                        if (this.tables[i].turn_start_at == 0) {
                            this.tables[i].users[pl] = {
                                id: '',
                                numeric_id: '',
                                name: '',
                                profile_pic: '',
                                position: pl,
                                is_active: false,
                                is_done: false,
                                is_left: false,
                                rank: 0,
                                life: 0,
                                dices_rolled: [],
                                bonus_dice: 0,
                                tokens: [-1, -1, -1, -1],
                            };

                            return {
                                res: false,
                                flag: 1,
                            };
                        }
                    } else {
                    }
                }
                return {
                    res: false,
                };
            }
        }
        return {
            res: false,
        };
    }

    // set all room data and player data for start game
    startGame = async (room) => {
        const table = await getTable(room);
        console.log('TABLE WHERE startGame', JSON.stringify(table, undefined, 2));
        if (!table) return Promise.resolve(false);
    
        const playersJoined = table.users.reduce((prev, user) => (user.is_active ? prev + 1 : prev), 0);
        if (playersJoined != table.no_of_players) return Promise.resolve(false);
    
        const player = table.users.find((user) => user.is_active);
        console.log('PLAYER', player, table);
        table.current_turn = player.position;
        table.current_turn_type = "roll";
        table.turn_start_at = new Date().getTime();
        table.game_started_at= new Date().getTime();
        table.last_dice_rolled=1;
    
        const dice = this.rollDice()
    
        await updateTable(table.room, table);
        table.users[player.position].dices_rolled.push(dice);
        await updateUser(table.room, player.position, player);
        await removeRoomFromSet(_.pick(table, ['room', 'type', 'no_of_players', 'no_of_winners', 'room_fee']));
        console.log("__BUDDY_TABLE_TYPE", table.room_type);
        // if (table.room_type === TABLE_TYPES.TOU) await TableService.addTournamentBuddies(table);
        return Promise.resolve({
            status: 1,
            message: 'Done',
            room: table.room,
            table: {
                room : table.room,
                room_fee : table?.room_fee,
                no_of_players : table?.no_of_players,
                current_turn : table?.current_turn,
                users : table?.users?.map((elem)=>{
                    return {
                        life : elem?.life,
                        is_active : elem?.is_active,
                        tokens : elem?.tokens,
                        rank : elem?.rank,
                        is_left : elem?.is_left,
                        is_done : elem?.is_done,
                        name : elem?.name,
                        profile_pic : elem?.profile_pic,
                    }
                })
            },
            dice: dice,
            possition: player.position,
        });
    };

    // romove all game data of room 
    abortGame = async (room) => {
        console.log('ABORT');
        await removeTable(room);
        return Promise.resolve(true);
    };

    // check for can we start game
    async canStartGame(i) {
        var players = 0;
        for (let pl = 0; pl < this.tables[i].users.length; pl++) {
            if (this.tables[i].users[pl].is_active) players++;
        }

        if (players == this.tables[i].no_of_players) return true;
        else return false;
    }

    //store new dice roll value
    diceRolled = async (room, position, dice, clearSix) => {
        const table = await getTable(room);
        if (!table) return Promise.resolve(false);
    
        const user = table.users.find((user) => user.position == position);
        if (!user) return Promise.resolve(false);
        console.log("in clear dices 1")
        user.dices_rolled=[]
        if(clearSix){
            user.six_counts=0
        }
    
        user.dices_rolled.push(dice);
        await updateUser(table.room, user.position, user);
        return Promise.resolve(true);
    };

    // get bonus dice count
    getBonus = async (room, user_id) => {
        console.log("bonus in get bonus", room, user_id);
        const table = await getTable(room);
        if (!table) return Promise.resolve(0);
    
        const user = table.users.find((user) => user.id == user_id.toString() && !user.is_left);
        if (!user) return Promise.resolve(0);
        console.log("bonus in get bonus", user.bonus_dice);
    
        return Promise.resolve(user.bonus_dice);
    };
    
    // reduce bonus dice count by 1
    useBonus = async (room, user_id) => {
        const table = await getTable(room);
        if (!table) return Promise.resolve(0);
    
        const user = table.users.find((user) => user.id == user_id.toString() && !user.is_left);
        if (!user) return Promise.resolve(0);
    
        if (user.bonus_dice > 0) {
            user.bonus_dice--;
            console.log("use bonus", user.bonus_dice);
            await updateUser(table.room, user.position, user);
        }
    
        return Promise.resolve(user.bonus_dice);
    };

    //add bonus dice by if user kill any plare or any pawn reach to final destinatiom
    addBonus = async (room, user_id, length) => {
        console.log("in add bonus",room, user_id, length);
        const table = await getTable(room);
        if (!table) return Promise.resolve(0);
    
        const user = table.users.find((user) => user.id == user_id.toString() && !user.is_left);
        if (!user) return Promise.resolve(0);
        console.log("before add bonus", user.bonus_dice);
        // user.bonus_dice += length;
        user.bonus_dice = 1;
        console.log("add bonus", user.bonus_dice);
        await updateUser(table.room, user.position, user);
    
        return Promise.resolve(user.bonus_dice);
    };

    // it will remove current dice value from user
    scrapTurn = async (room, position) => {
        const table = await getTable(room);
        if (!table) return Promise.resolve(false);
    
        const user = table.users.find((user) => user.position == position);
        if (!user) return Promise.resolve(false);
        console.log("in scrapTurn", user, user.dices_rolled[0]);
        user.dices_rolled = [];
        await updateTable(table.room, table)
        await updateUser(table.room, user.position, user);
    
        return Promise.resolve(true);
    };

    // it will clear dice value
    clearDices= async(room, position) =>{
        const table = await getTable(room);
        if (!table) return Promise.resolve(false);
    
        const user = table.users.find((user) => user.position == position);
        if (!user) return Promise.resolve(false);
    
        console.log("in clear dices 2")    
        user.dices_rolled = [];
        await updateUser(table.room, user.position, user);
    
        return Promise.resolve(true);
    }

    // use for get user's position in array by id
    getMyPosition = async (room, user_id) => {
        const table = await getTable(room);
        if (!table) return Promise.resolve(-1);
    
        const user = table.users.find((user) => {if(user.id == user_id && !user.is_left){return true}});
        if (!user) return Promise.resolve(-1);
    
        return Promise.resolve(user.position);
    };

    // set last dice rolled 
    setLastdiceolled= async (room ,dice)=>{
        return await this.setLastdiceolled(room, dice)
    }

    // verify current turn is of player who try to make diceroll or move
    isCurrentTurnIsMine = async (room, user_id, type) => {
        const table = await getTable(room);
        console.log("in is currnt turn mine!!!",table, table.current_turn,user_id,table.current_turn_type,type, user_id,table.current_turn_type==type);
        if(!table.current_turn_type==type)return Promise.resolve(false);
        if (!table) return Promise.resolve(false);
        for( let i=0;i<table.users.length ;i++){
            if(table.users[i].id == user_id && !table.users[i].is_left && table.current_turn==i && table.current_turn_type==type){
                console.log("user...", table.users[i], table.current_turn, i);
                return true
            }

        }
        return false
    };
    
    // get dice value of current player
    getMyDice = async (room, user_id) => {
        console.log("params", room, user_id)
        if (room.value) await this.updateMyDice(room.room, user_id, parseInt(room.value));
        const table = await getTable(room.room);
        if (!table) return Promise.resolve(-1);
    
        const user = table.users.find((user) => user.id == user_id.toString() && !user.is_left);
        if (!user) return Promise.resolve(-1);
        return Promise.resolve(user.dices_rolled.length > 0 ? user.dices_rolled[user.dices_rolled.length - 1] : -1);
    };

    //update value of dice
    updateMyDice = async (room, user_id, dice) => {
        const table = await getTable(room);
        if (!table) return Promise.resolve(false);
    
        const user = table.users.find((user) => user.id == user_id.toString() && !user.is_left);
        if (!user) return Promise.resolve(false);
        user.dices_rolled=[];
    
        user.dices_rolled.push(dice);
        await updateUser(table.room, user.position, user);
        return Promise.resolve(true);
    };

    // is 3 time six occures
    jackPot = async (room, user_id) => {
        const table = await getTable(room);
        if (!table) return Promise.resolve(false);
    
        const user = table.users.find((user) => user.id == user_id.toString() && !user.is_left);
        if (!user) return Promise.resolve(false);
    
        return Promise.resolve(
            user.dices_rolled.length == 3 &&
            user.dices_rolled[0] == 6 &&
            user.dices_rolled[1] == 6 &&
            user.dices_rolled[2] == 6
        );
    };

    // increse six count by 1
    addSix= async(room, id) =>{
        const table = await getTable(room);
        if (!table) return Promise.resolve(false);
    
        const user = table.users.find((user) => user.id ==id && !user.is_left);
        if (!user) return Promise.resolve(false);
        
        user.six_counts +=1;
        console.log("six count now add ", user.six_counts);
        await updateUser(table.room, user.position, user);
    
        return Promise.resolve(true);
    }

    // set six count to 0
    setSix= async(room, id) =>{
        const table = await getTable(room);
        if (!table) return Promise.resolve(false);
    
        const user = table.users.find((user) => user.id == id && !user.is_left);
        if (!user) return Promise.resolve(false);
        
        user.six_counts =0;
        console.log("six count set to 0 now");
        await updateUser(table.room, user.position, user);
    
        return Promise.resolve(true);
    }

    // get total six counts
    getSix= async(room, id) =>{
        const table = await getTable(room);
        if (!table) return 0
    
        const user = table.users.find((user) => user.id == id && !user.is_left);
        console.log("user", user);
        if (!user) return 0
        
    
        return user.six_counts;
    }  

    // update current turn (chnage turn and set next player as current player)
    updateCurrentTurn = async (room, position, type, prev) => {
        const table = await getTable(room);
        if (!table) return Promise.resolve(false);
    
        if (prev != -1) {
            const prevUser = table.users.find((user) => user.position == position);
            if (!prevUser) return Promise.resolve(false);
            console.log("in clear dices")
            prevUser.dices_rolled = [];
            await updateUser(table.room, prevUser.position, prevUser);
        }
    
        table.current_turn = position;
        table.turn_start_at = new Date().getTime();
        table.current_turn_type = type;
    
        await updateTable(room, table);
        return Promise.resolve(true);
    };

    // get current player dices
    gePlayerDices = async (room, position) => {
        const table = await getTable(room);
        if (!table) return Promise.resolve([]);
    
        const user = table.users.find((user) => {if(user.position == position){return true}});
        if (!user) return Promise.resolve([]);
    
        return Promise.resolve(user.dices_rolled);
    };

    // get next position
    getNextPosition = async (room, position) => {
        const table = await getTable(room);
        if (!table) return Promise.resolve(-1);
    
        let index = position;
        while (++index < table.users.length)
            if (table.users[index].is_active && !table.users[index].is_done) return Promise.resolve(index);
        index = -1;
        while (++index < position)
            if (table.users[index].is_active && !table.users[index].is_done) return Promise.resolve(index);
    
        return Promise.resolve(-1);
    };

    // check any token kills
    canIKill = async (room, user_id, token_index, position) => {
        const table = await getTable(room);
        if (!table) return Promise.resolve(false);
    
        // Get actual position
        const actual_position = config.MOVE_PATH[position][table.users[position].tokens[token_index]];
        if (config.safeZone.includes(actual_position)) return Promise.resolve(false);
        var dead_possible = [];
        for (let j = 0; j < table.users.length; j++) {
            if (table.users[j].id != user_id && !table.users[j].is_done) {
                for (let k = 0; k < table.users[j].tokens.length; k++) {
                    if (table.users[j].tokens[k] != -1) {
                        let other_token_position = config.MOVE_PATH[j][table.users[j].tokens[k]];
                        if (other_token_position == actual_position) {
                            dead_possible.push({
                                user: j,
                                token: k,
                                // total_steps:table.users[j].tokens[k]
                            });
                        }
                    }
                }
            }
        }
    
        let us = [];
        let i = 0;
        while (i < dead_possible.length) {
            if (us.indexOf(dead_possible[i].user) > -1) {
                dead_possible = dead_possible.filter((e) => e.user != dead_possible[i].user);
                i = 0;
                continue;
            } else {
                us.push(dead_possible[i].user);
            }
            i++;
        }
    
        for (i = 0; i < dead_possible.length; i++) {
            let user = table.users.find((user) => user.position == dead_possible[i].user);

            user.tokens[dead_possible[i].token] = -1;
            await updateUser(table.room, user.position, user);
        }
    
        return Promise.resolve(dead_possible.length > 0 ? dead_possible : false);
    };
    
    // check move is possible or not
    isMovePossible = async (room, user_id) => {
        const table = await getTable(room);
        if (!table) return Promise.resolve(false);
    
        const user = table.users.find((user) => user.id == user_id.toString() && !user.is_left);
        if (!user) return Promise.resolve(false);
    
        return Promise.resolve(
            user.tokens.some((token) =>
                user.dices_rolled.some(
                    (dice) =>
                        (token == -1 && (dice == 6)) ||
                        (token != -1 && token + dice <= 56)
                )
            )
        );
    };

    //get movable token
    getMovableToken = async (room, user_id) => {
        console.log("in get user movable token");
        const table = await getTable(room);
        if (!table) return Promise.resolve(false);
    
        const user = table.users.find((user) => user.id == user_id.toString() && !user.is_left);
        if (!user) return Promise.resolve(false);
        let dice = user.dices_rolled;
        console.log("in get user movable token",dice[0], user.tokens);


        for (let i=0;i<user.tokens.length;i++){
            console.log("here in the test",user.tokens[i], user.tokens[i] + dice[0] );
            if((user.tokens[i] == -1 && (dice[0] == 6)) || (user.tokens[i] != -1 && user.tokens[i] + dice[0] <= 56)){
                console.log("index", i)
                    return i
                }
        }
        
    };

    //get movable token count
    getMovableTokenCount = async (room, user_id) => {
        // console.log("in get user movable token", room, user_id);
        const table = await getTable(room);
        if (!table) return Promise.resolve(false);
    
        const user = table.users.find((user) => user.id == user_id && !user.is_left);
        if (!user) return Promise.resolve(false);
        let dice = user.dices_rolled;
        // console.log("in get user movable token 1",dice[0], user.tokens);
        let count=0;

        for(let i=0;i<user.tokens.length;i++){
            // console.log("here in the test",i,user.tokens[i], user.tokens[i] + dice[0] );
            if((user.tokens[i] == -1 && (dice[0] == 6)) || (user.tokens[i] != -1 && user.tokens[i] + dice[0] <= 56)){
            //    console.log("count ++");
                count++
                }
                // console.log("in return count");
                
        }
        return count;
        
    };

    //check all token is at initial position and dice roll = 6
    isAllAtInitial = async (room, user_id) => {
        const table = await getTable(room);
        if (!table) return Promise.resolve(false);
    
        const user = table.users.find((user) => user.id == user_id && !user.is_left);
        if (!user) return Promise.resolve(false);
        let dice = user.dices_rolled;
        // console.log("in get user movable token 1",dice[0], user.tokens);
        let count=0;

        for(let i=0;i<user.tokens.length;i++){
            // console.log("here in the test",i,user.tokens[i], user.tokens[i] + dice[0] );
            if(user.tokens[i] == -1 && (dice[0] == 6)){
                count++
            }
        }
        return count==4
        
    };

    //check move pssible exact
    isMovePossibleExact = async (dice, room, user_id, token_index) => {
        const table = await getTable(room);
        if (!table) return Promise.resolve(false);
    
        const user = table.users.find((user) => user.id == user_id.toString() && !user.is_left);
        if (!user) return Promise.resolve(false);
    
        if (user.dices_rolled.indexOf(dice) == -1) return Promise.resolve(false);
        const token = user.tokens[token_index];
        return Promise.resolve(
            (token == -1 && (dice == 6)) || (token != -1 && token + dice <= 56)
        );
    };

    // make pawn move by pawn index romm and uer_id for dice value
    makeMove = async (dice, room, user_id, token_index) => {
        const table = await getTable(room);
        if (!table) return Promise.resolve(-1);
    
        const user = table.users.find((user) => user.id == user_id.toString() && !user.is_left);
        if (!user) return Promise.resolve(-1);
    
        user.dices_rolled.splice(user.dices_rolled.indexOf(dice), 1);
    
        if (user.tokens[token_index] == -1 && (dice == 1 || dice == 6)) user.tokens[token_index] = 0;
        else if (user.tokens[token_index] + dice <= 56) user.tokens[token_index] += dice;
    
        await updateUser(table.room, user.position, user);
        return Promise.resolve(user.tokens[token_index]);
    };

    //check all token is reach to destination
    allHome = async (room, user_id) => {
        const table = await getTable(room);
        if (!table) return Promise.resolve(false);
    
        const user = table.users.find((user) => user.id == user_id.toString() && !user.is_left);
        if (!user) return Promise.resolve(false);


        const allTokensHome = user.tokens.reduce((prev, token) => prev && token == 56, true);

        if (!allTokensHome) return Promise.resolve(false);
    
        table.players_won += 1;
        table.players_done += 1;
        await updateTable(table.room, table);
    
        user.is_done = true;
        user.rank = table.players_won;
        await updateUser(table.room, user.position, user);
    
        return Promise.resolve({ rank: user.rank, position: user.position });
    };

    // check is only player left
    isThisTheEnd= async (room) => {
        const table = await getTable(room);
        console.log("is this the end???....", room, table)
        var rank = [];
        let apiData={"room":room,
        "users":[]
        };
            for (let j = 0; j < table.users.length; j++) {
                let amount =
                table.users[j].rank != 1
                        ? 0 - table.room_fee
                        : table.win_amount
                console.log("table.user.id", table.users[j].id!='', table.users[j].id);
                if(table.users[j].id!=''){
                rank.push({
                    // player_index: table.users[j].position,
                    name: table.users[j].name,
                    // numeric_id: table.users[j].numeric_id,
                    rank: table.users[j].rank,
                    amount: amount,
                    id: table.users[j].id,
                    // token: table.users[j].id
                });
                apiData.users.push({
                    "player":table.users[j].id,
                    "winStatus":table.users[j].rank==1?1:0,
                    "amount": table.users[j].rank==1? table.win_amount:0
                    })
                }
            }

            console.log("rank", rank);
            if (table.no_of_players == 2) {
                if (table.players_won >= 1) {
                    await removeTable(room);
                    if(process.env.USE_API == "true"){
                        await rest_api.winnerDistribution(apiData);
                    }
                    return rank;
                }
            } 
            if (table.no_of_players == 3){
            if (table.players_won == 2) {
                await removeTable(room);
                if(process.env.USE_API == "true"){
                    await rest_api.winnerDistribution(apiData);
                }
                return rank;
            }else if (table.players_done >= 2) {
                await removeTable(room);
                if(process.env.USE_API == "true"){
                    await rest_api.winnerDistribution(apiData);
                }
                return rank;
            } else return false;
            }
            else if (table.no_of_players == 4) {
                if (table.players_won == 3) {
                    this.tables = this.tables.filter((t) => t.room != room);
                    await removeTable(room);
                    return rank;
                } else if (table.players_done >= 3) {
                    for (let j = 0; j < table.users.length; j++) {
                        if (table.users[j].is_active && !table.users[j].is_done) {
                            table.players_won += 1;
                            table.players_done += 1;
                            table.users[j].is_done = true;
                            table.users[j].rank = table.players_won;
                        }
                    }
                    rank = [];
                    for (let j = 0; j < table.users.length; j++) {
                        let amount =
                            table.users[j].rank != 1
                                ? 0 - table.room_fee
                                : table.win_amount
                        if(table.users[j].id!=''){
                        rank.push({
                            // player_index: table.users[j].position,
                            name: table.users[j].name,
                            // numeric_id: table.users[j].numeric_id,
                            rank: table.users[j].rank,
                            amount: amount,
                            id: table.users[j].id,
                            // token: table.users[j].id
                        });
                    }
                    }
                    this.tables = this.tables.filter((t) => t.room != room);
                    await removeTable(room);
                    if(process.env.USE_API == "true"){
                        await rest_api.winnerDistribution(apiData);
                    }
                    return rank;
                } else return false;
            }

        
        return false;
    }

    // check only one player left
    checkOnlyPlayerLeft = async (room) => {
        const table = await getTable(room);
        if (!table) return Promise.resolve(false);
        console.log(table.no_of_players ,table.players_done)

    
        if (table.no_of_players - table.players_done != 1) return Promise.resolve(false);
    
        const user = table.users.find((user) => user.is_active && !user.is_done && !user.is_left);
        if (!user) return Promise.resolve(true);
        console.log("only player left", user);
        console.log("only player left", table);

    
        table.players_won += 1;
        table.players_done += 1;
        await updateTable(table.room, table);
    
        user.is_done = true;
        user.rank = table.players_won;
        await updateUser(table.room, user.position, user);
        return Promise.resolve(true);
    };

    //check current turn is of player who is asking for roll or move
    isCurrentTurnMine = async (room, position) => {
        const table = await getTable(room);
        if (!table) return Promise.resolve(false);
        return Promise.resolve(table.current_turn == position);
    };

    // get total life of player
    getMyLife = async (room, user_id) => {
        const table = await getTable(room);
        if (!table) return Promise.resolve(0);
    
        const user = table.users.find((user) => user.id == user_id.toString() && !user.is_left);
        if (!user) return Promise.resolve(0);
    
        return Promise.resolve(user.life);
    };

    // deduct life of player
    deductLife = async (room, user_id) => {
        const table = await getTable(room);
        if (!table) return Promise.resolve(true);
    
        const user = table.users.find((user) => user.id == user_id.toString() && !user.is_left);
        if (!user) return Promise.resolve(true);
    
        user.life--;
        await updateUser(table.room, user.position, user);
    
        return Promise.resolve(true);
    };

    // get player id by position
    getMyIdByPosition = async (room, position) => {
        const table = await getTable(room);
        if (!table) return Promise.resolve(-1);
    
        const user = table.users.find((user) => user.position == position);
        if (!user) return Promise.resolve(-1);
    
        return Promise.resolve(user.id);
    };
    
    // get tokens of player
    getTokens = async (room) => {
        const table = await getTable(room);
        if (!table) return Promise.resolve([]);
    
        return Promise.resolve(table.users.map((user) => Object({ user_id: user.id, tokens: user.tokens })));
    };

    // set last dice rolled
    setLastdiceolled= async(room, dice)=>{
        const table = await getTable(room);
        if (!table) return Promise.resolve([]);
        table.last_dice_rolled=dice;
        await updateTable(room,table)
    }
    
    // generate random dice roll
    rollDice() {
        return Math.floor(Math.random() * 6) + 1;
    }

}

module.exports = {
    _Tables,
};
