const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    socketId: { type: String, unique: true, required: true },
    balances: {
        BTC: { type: Number, default: 0.00 },
        ETH: { type: Number, default: 0.00 },
        USDT: { type: Number, default: 0.00 }
    },
});

module.exports = mongoose.model('User', userSchema);
