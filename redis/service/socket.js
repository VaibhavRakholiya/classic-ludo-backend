//All function is use to store and get data from redis.
const redisClient = require('../redis');
const TABLE_PREFIX = `TABLE`;
const USER_TABLE_MAP_PREFIX = `USER_IN_TABLE`;
const SEARCH_TABLE_PREFIX = `SEARCH_TABLE`;
const tableKey = (roomId) => [TABLE_PREFIX, roomId].join(DELIMITER);
const userKey = (roomId, index) => [TABLE_PREFIX, roomId, 'users', index].join(DELIMITER);
const userTableMapKey = (userId) => [USER_TABLE_MAP_PREFIX, userId].join(DELIMITER);
const searchTableKey = (type, room_fee, players, contest_id) =>[SEARCH_TABLE_PREFIX, type, 'room_fee', room_fee, 'players', players, 'contest_id',contest_id].join(DELIMITER);
const DELIMITER = ':';
const KEY_USER = `socket_user_key${process.env.NODE_ENV}`;
const BoolVal = (val) => val == true || val == 'true';
var _ = require('lodash');

// function user for store user with user id ex: user_<user_id>
function userPrefix(string) {
  return `user_${string}`;
}

// function user for store socket with socket id ex: socket_<socket_id>
function socketPrefix(string) {
  return `socket_${string}`;
}

//function user for store room with room id ex: room_<room_id>
function roomPrefix(string) {
  return `room_${string}`;
}

// function use for map socket_id with user_id and cise versa
const SOC_save = async (user_id, socket_id) => {
  try {
    console.log(`Socket event fired:: user :: ${user_id}, ${socket_id}`);
      user_id = user_id.toString();
      let [user] = await redisClient.multi().hget(KEY_USER, userPrefix(user_id)).execAsync();
      console.log(`SOC_save :: user :: ${user}`);
      if (user) {
          await redisClient
              .multi()
              .hdel(KEY_USER, [userPrefix(user_id)])
              .execAsync();
      }

      let response = await redisClient
          .multi()
          .hset(KEY_USER, userPrefix(user_id), socket_id)
          .hset(KEY_USER, socketPrefix(socket_id), user_id)
          .execAsync();
      return Promise.resolve(response);
  } catch (error) {
      console.log('>>> EXCEPTION >> ', error);
      return Promise.reject(error);
  }
};

// function use for get user_id from socket_id
const SOC_getUserId = async (socket_id) => {
  try {
      let [user_id] = await redisClient.multi().hget(KEY_USER, socketPrefix(socket_id)).execAsync();
      return Promise.resolve(user_id);
  } catch (error) {
      console.log('>>> EXCEPTION >> ', error);
      return Promise.resolve(null);
  }
};

// function use for get socket_id from user_id
const SOC_getSocketId = async (user_id) => {
  try {
      let [socket_id] = await redisClient.multi().hget(KEY_USER, userPrefix(user_id)).execAsync();
      return Promise.resolve(socket_id);
  } catch (error) {
      console.log('>>> EXCEPTION >> ', error);
      return Promise.resolve(null);
  }
};

// function use for get table from user_id
const getTableFromUser = async (user_id) => {
  console.log("user table map key", userTableMapKey(user_id))
  const userTableMap = await redisClient.hgetallAsync(userTableMapKey(user_id));
  console.log('userTableMap', userTableMap);
  if (!userTableMap) return Promise.resolve(false);
  let table = await getTable(userTableMap.room);
  console.log('table', table);
  if (!table) return Promise.resolve(false);
  return Promise.resolve(table);
};

// function use for check is any seat empty on room
const canSeat = (table, buddies) => {
  if (!table) return { flag: false, timerStart: 0 };
  if (!table.users) return { flag: false, timerStart: 0 };

  if (buddies) {
      console.log("Users", table.users.map(user => user.id), "Buddies", buddies);
      for (let user of table.users) {
          for (let buddy of buddies) {
              if (!_.isEmpty(user.id) && user.id.toString() === buddy.toString()) {
                  console.log("BUDDY CONFLICT");
                  return { flag: false, timerStart: 0 };
              }
          }
      }
      console.log("BUDDY PASS");
  } else {
      console.log("BUDDY LESS");
  }

  const activePlayers = table.users.reduce((a, b) => (b.is_active ? a + 1 : a), 0);
  const seatsOnTable = table.no_of_players;
  let timerStart = 120
  return {
      flag: activePlayers < seatsOnTable,
      room: table.room,
      timerStart: timerStart,
  };
};

// function is use for get full table object 
const getTableObject = (table) => {
  table = clone(table);
  if (table) {
      table.room = table.hasOwnProperty('room') ? String(table.room) : ' ';//room code 
      table.room_type = table.hasOwnProperty('room_type') ? String(table.room_type) : TABLE_TYPES.PUB;// type of room public or private  rightnow pub
      table.contest_id = table.hasOwnProperty('contest_id') ? String(table.contest_id) : '123';//contest id default we put 123 if no any contest id given
      table.created_by = table.hasOwnProperty('created_by') ? String(table.created_by) : ' ';// is of player who create room(first joined player)
      table.created_at = table.hasOwnProperty('created_at') ? Number(table.created_at) : 0;//timezone whem room created
      table.room_fee = table.hasOwnProperty('room_fee') ? Number(table.room_fee) : 0;//room fee(entry fees)
      table.win_amount = table.hasOwnProperty('win_amount') ? Number(table.win_amount) : Number(table.room_fee);//winning amount
      table.players_done = table.hasOwnProperty('players_done') ? Number(table.players_done) : 0;// players done (player who completed game or left game) by default 0
      table.players_won = table.hasOwnProperty('players_won') ? Number(table.players_won) : 0;// player who win the game default 0
      table.current_turn = table.hasOwnProperty('current_turn') ? Number(table.current_turn) : -1;// index current turn default -1
      table.no_of_players = table.hasOwnProperty('no_of_players') ? Number(table.no_of_players) : 0;// no of total players 
      table.no_of_winners = table.hasOwnProperty('no_of_winners') ? Number(table.no_of_winners) : 0;// no of total winner
      table.dice_rolled_at = table.hasOwnProperty('dice_rolled_at') ? Number(table.dice_rolled_at) : -1;// dice rolled at (last dice rolled at)
      table.game_started_at = table.hasOwnProperty('game_started_at') ? Number(table.game_started_at) : -1;// game start time
      table.current_turn_type = table.hasOwnProperty('current_turn_type')
          ? String(table.current_turn_type)
          : 'roll';// current turn type "roll" or "move"  default roll for first player
      table.last_dice_rolled= table.hasOwnProperty('last_dice_rolled') ? Number(table.last_dice_rolled) : 0;// store last dice value for unity side handling
      table.turn_start_at = table.hasOwnProperty('turn_start_at') ? Number(table.turn_start_at) : 0;// last turn started at timestemp
      delete table.users;
  }
  return table;
};

//function is use for get user object
const getUserObject = (user, index) => {
  // console.log("user in", user);
  user = clone(user);
  if (user) {
      user.id = user.hasOwnProperty('userId') ? String(user.userId) : user.hasOwnProperty('userId') ? String(user.userId) : '';// id of user
      delete user._id;
      user.numeric_id = user.hasOwnProperty('userId')
          ? String(user.userId):'';//numeric id not use yet
      user.name = user.hasOwnProperty('name')
          ? String(user.user_name)
          : user.hasOwnProperty('user_name')
              ? String(user.user_name)
              : '';// user name
      delete user.userName;
      user.profile_pic = user.hasOwnProperty('profile_pic')
          ? String(user.profile_pic)
          : user.hasOwnProperty('profilepic')
              ? String(user.profilepic)
              : '';// user profile pic
      delete user.profilepic;
      user.position = user.hasOwnProperty('position') ? Number(user.position) : index;// user's position in arry
      user.is_active = user.hasOwnProperty('is_active') ? BoolVal(user.is_active) : user.id != '';// user's status active or not (if user left game status will be false) default true
      user.is_done = user.hasOwnProperty('is_done') ? BoolVal(user.is_done) : false;// user's game is completed or not 
      user.is_left = user.hasOwnProperty('is_left') ? BoolVal(user.is_left) : false;// user is left game or not
      user.rank = user.hasOwnProperty('rank') ? Number(user.rank) : 0;// rank of user default 0
      user.life = user.hasOwnProperty('life') ? Number(user.life) : 0;// life of user default 0 after 5 life user will drop from game
      user.six_counts= user.hasOwnProperty('six_counts')? Number(user.six_counts):0;// count of six (use for check how many times six occures constant)
      user.dices_rolled = user.hasOwnProperty('dices_rolled') ? parseArray(user.dices_rolled) : [];// store current dice roll value
      user.bonus_dice = user.hasOwnProperty('bonus_dice') ? Number(user.bonus_dice) : 0;// store how nay bonus turn remaining
      user.dice_rolled_at = user.hasOwnProperty('dice_rolled_at') ? Number(user.dice_rolled_at) : -1;// lst dice rolled at
      user.is_first_roll = user.hasOwnProperty('is_first_roll') ? BoolVal(user.is_first_roll) : false; // to check user has roll first dice or not
      user.token = user.hasOwnProperty('token') ? user.token : '';// token (unique token of user)
      user.tokens = user.hasOwnProperty('tokens')
          ? parseArray(user.tokens)
          : [-1, -1, -1, -1];// this is users pawns and it's position
  }
  // console.log("user", user)
  return user;
};

// function is use to convert function in valid json
const parseRedis = (obj) => {
  obj = clone(obj);

  return Object.entries(obj).reduce((prev, entry) => {
      prev.push(...entry.map((e) => (Array.isArray(e) ? JSON.stringify(e) : String(e))));
      return prev;
  }, []);
};
const parseArray = (arr) => (Array.isArray(arr) ? arr : JSON.parse(arr));

//it reassign object and crete clone of object
const clone = (obj) => {
  let cloneObj = Object.assign({}, obj);
  return cloneObj;
};

//use for save table(room) in redis 
const saveTable = async (table) => {
  table = clone(table);
  let rc = redisClient.multi();
  rc = rc.hset(tableKey(table.room), ...parseRedis(getTableObject(table)));
  [0, 1, 2, 3].forEach(
      (position) => (rc = rc.hset(userKey(table.room, position), ...parseRedis(getUserObject({}, position))))
  );
  rc = rc.sadd(
      searchTableKey(table.room_type, table.room_fee, table.no_of_players, table.contest_id),
      table.room
  );
  await rc.execAsync();
  console.log(`REDIS :: saveTable :: ${table.room} :: ${JSON.stringify(table)}`);
  return Promise.resolve(table.room);
};

//use fot get full table(room) from redis
const getTable = async (room) => {
  let table = await redisClient.hgetallAsync(tableKey(room));
  // console.log("REDIS :: getTable :: ", room);
  if (!table) {
      console.log("REDIS :: table Expired :: ", room);
      return Promise.resolve(false)
  };
  table = getTableObject(table);
  table.users = await Promise.all([0, 1, 2, 3].map(async (position) => await getUser(room, position)));
  // console.log(`REDIS :: getTable :: ${table.room}}`);
  return Promise.resolve(table);
};

//use fr get all public table stored in redis
const getPublicTables = async (room_fee, no_of_players, contest_id) => {
  let [rooms] = await redisClient
      .multi()
      .smembers(searchTableKey('PUB', room_fee, no_of_players, contest_id))
      .execAsync();
  console.log(`REDIS :: getPublicTables :: ${rooms}}`);
  return await Promise.all(rooms.map(async (room) => await getTable(room)));
};

//use for get user from room code and position from redis
const getUser = async (room, position) => {
  const user = await redisClient.hgetallAsync(userKey(room, position));
  if (!user) return Promise.resolve(false);
  // console.log(`REDIS :: getUser :: ${room} :: ${position}}`);
  return Promise.resolve(getUserObject(user));
};

//function update full table by room code
const updateTable = async (room, table) => {
  table = clone(table);

  let response = await redisClient
      .multi()
      .hset(tableKey(room), ...parseRedis(getTableObject(table)))
      .execAsync();
  console.log(`REDIS :: updateTable :: ${room} :: ${JSON.stringify(table)} :: `, response);
};

//function update full user by room code
const updateUser = async (room, position, user) => {
  user = clone(user);
  let response = await addUserOnTable(room, position, user);
  console.log(
      `REDIS :: updateUser :: ${room} :: ${position} :: ${JSON.stringify(user)} :: `,
      JSON.stringify(response)
  );
};

//function remove room from data
const removeRoomFromSet = async (table) => {
  table = clone(table);
  return await redisClient
      .multi()
      .srem(searchTableKey(table.room_type, table.room_fee, table.no_of_players, table.contest_id), table.room)
      .execAsync();
};

//function remove full table
const removeTable = async (room) => {
  console.log("in remove table....", room)
  const table = await getTable(room);
  if (!table) return Promise.resolve(false);

  const mapKeys = table.users.map((user) => userTableMapKey(user.id));
  const userKeys = [0, 1, 2, 3].map((index) => userKey(room, index));

  console.log("in srem", searchTableKey(table.room_type, table.room_fee, table.no_of_players, table.contest_id));
  console.log("in srem", table.room);
  table.users.map(async(user)=>{
    if(user.id!=""){
    let socket_id= await SOC_getSocketId(user.id)
    await redisClient
    .multi()
    .hdel(KEY_USER, [socketPrefix(socket_id)])
    .srem(searchTableKey(table.room_type, table.room_fee, table.no_of_players, table.contest_id),table.room)
    .execAsync();
    }
  })

  const keys = [tableKey(room), ...mapKeys, ...userKeys];

  let response = await redisClient
      .multi()
      .del(keys)
      .srem(searchTableKey(table.room_type, table.room_fee, table.no_of_players, table.contest_id), table.room)
      .execAsync();

  console.log(`REDIS :: removeTable :: ${room} :: ${keys} :: `, response);
};

// function add user on table
const addUserOnTable = async (room, position, user) => {
  user = clone(user);
  // console.log("user", user)

  const userObj = getUserObject(user, position);
  let response = await redisClient
      .multi()
      .hset(userKey(room, position), ...parseRedis(userObj))
      .execAsync();
  if (!_.isEmpty(userObj.id)) await redisClient.multi().hset(userTableMapKey(userObj.id), 'room', room).execAsync();
  console.log(`REDIS :: addUserOnTable :: ${room} :: ${position} :: ${JSON.stringify(userObj)} :: `, response);
  return Promise.resolve(await getTable(room));
};

// function remove user
const freeUser = async (user_id) => await redisClient.multi().del(userTableMapKey(user_id.toString())).execAsync();

module.exports = {
  SOC_save,
  getTableFromUser,
  getPublicTables,
  canSeat,
  saveTable,
  SOC_getUserId,
  getTable,
  addUserOnTable,
  updateTable,
  updateUser,
  removeRoomFromSet,
  freeUser,
  removeTable,
  SOC_getSocketId
};
