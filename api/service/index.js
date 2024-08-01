var ObjectId = require('mongoose').Types.ObjectId;

module.exports = {
    response: function(status, message, data) {
        return {
            status: status,
            message: message,
            data: data
        };
    },

    randomNumber: async function(length) {
        return Math.floor(
            Math.pow(10, length - 1) + Math.random() * (Math.pow(10, length) - Math.pow(10, length - 1) - 1)
        );
    },

};
