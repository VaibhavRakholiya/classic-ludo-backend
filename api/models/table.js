var mongoose = require('mongoose'),
    Schema = mongoose.Schema;

var TableModel = new Schema({
    room: {
        type: String,
        required: true
    },
    room_type: {
        type: String,
        enum: ['PUB', 'PVT']
    },
    no_of_players: {
        type: Number
    },
    created_by: {
        type: String
    },
    created_at: {
        type: Number
    },
    game_started_at: {
        type: String,
        default: '-1'
    },
    game_completed_at: {
        type: String,
        default: '-1'
    },
    created_date: {
        type: Date,
        default: Date.now()
    },
    room_fee: {
        type: Number
    },
    contest_id:{
        type:Number
    },
    win_amount:{
        type: Number
    },
    players: [{
        id: {
            type: String,
            required: true,
        },
        rank: {
            type: Number,
            default: 0
        },
        fees:{
            type: Number,
            default: 0
        },
        pl:{
            type: Number,
            default: 0
        },
        name:{
            type: String,
            default: ""
        },
        profile_pic:{
            type: String,
            default: ""
        },
        token:{
            type: String,
            default: 0
        },  
        is_active:{
            type: Boolean,
            default: false
        }
    }],
});

module.exports = mongoose.model('Table', TableModel);