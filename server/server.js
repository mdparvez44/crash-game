const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const mongoose = require("mongoose");
const axios = require("axios");
const crypto = require('crypto');
require('dotenv').config(); // ADD THIS LINE at the very top

const User = require("./models/User");
const Transaction = require("./models/Transaction");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// MongoDB Connection
// Use the MONGODB_URI environment variable, fallback to localhost for safety if not set
mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/crash-game")
    .then(() => console.log("MongoDB connected successfully."))
    .catch(err => console.error("MongoDB connection error:", err));

const betSchema = new mongoose.Schema({
    socketId: String,
    userId: mongoose.Schema.Types.ObjectId,
    usdAmount: Number,
    cryptoAmount: Number,
    currency: String,
    usdRate: Number,
    multiplier: { type: Number, default: 1 },
    payoutCrypto: { type: Number, default: 0 },
    payoutUSD: { type: Number, default: 0 },
    status: { type: String, enum: ["placed", "cashedOut", "crashed"], default: "placed" },
    timestamp: { type: Date, default: Date.now },
    serverSeed: String,
    clientSeed: String,
    nonce: Number,
});

const Bet = mongoose.model("Bet", betSchema);

app.use(express.static("public"));
app.use(express.json());

const CACHE_DURATION_MS = 10 * 1000;
let priceCache = {};

async function getOrFetchCryptoPrice(symbolId) {
    const now = Date.now();
    if (priceCache[symbolId] && (now - priceCache[symbolId].timestamp < CACHE_DURATION_MS)) {
        console.log(`Serving ${symbolId} price from cache.`);
        return priceCache[symbolId].usd;
    }

    try {
        const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price`, {
            params: {
                ids: symbolId,
                vs_currencies: 'usd',
            },
        });

        if (response.data[symbolId]) {
            const usdPrice = response.data[symbolId].usd;
            priceCache[symbolId] = { usd: usdPrice, timestamp: now };
            return usdPrice;
        } else {
            console.warn(`CoinGecko: No data found for ID '${symbolId}'.`);
            return null;
        }
    } catch (error) {
        console.error("Error fetching crypto price:", error.message);
        if (error.response && error.response.status === 429) {
            const retryAfter = error.response.headers['retry-after'] || 60;
            console.warn(`CoinGecko Rate Limit Exceeded. Retry-After: ${retryAfter} seconds.`);
        }
        return null;
    }
}

app.get("/convert/:symbolId", async (req, res) => {
    const symbolId = req.params.symbolId;
    const usdPrice = await getOrFetchCryptoPrice(symbolId);
    if (usdPrice !== null) {
        res.json({ usd: usdPrice });
    } else {
        res.status(500).json({ error: "Failed to fetch crypto price." });
    }
});

app.get("/api/round-history", async (req, res) => {
    try {
        const history = await Bet.aggregate([
            { $match: { status: "crashed", serverSeed: { $ne: null } } },
            { $sort: { timestamp: -1 } },
            { $limit: 50 },
            {
                $group: {
                    _id: { serverSeed: "$serverSeed", nonce: "$nonce" },
                    crashPoint: { $first: "$multiplier" },
                    serverSeed: { $first: "$serverSeed" },
                    clientSeed: { $first: "$clientSeed" },
                    nonce: { $first: "$nonce" },
                    timestamp: { $first: "$timestamp" }
                }
            },
            { $sort: { timestamp: -1 } }
        ]);
        res.json(history);
    } catch (err) {
        console.error("Error fetching round history:", err);
        res.status(500).json({ error: "Failed to fetch round history." });
    }
});

let multiplier = 1;
let gameInterval = null;
let gameRunning = false;
let players = {};
let serverSeed = null;
let hashedServerSeed = null;
let clientSeed = "defaultClientSeed";
let nonce = 0;

const GAME_STATES = {
    WAITING_FOR_BETS: 'WAITING_FOR_BETS',
    GAME_RUNNING: 'GAME_RUNNING',
    ROUND_ENDED: 'ROUND_ENDED'
};
let currentGameState = GAME_STATES.ROUND_ENDED;
let roundTimer = null;
const BETTING_PHASE_DURATION_MS = 10000;
const ROUND_END_DURATION_MS = 3000;

let roundStartTime = 0;

function generateRandomHex(length) {
    return crypto.randomBytes(length / 2).toString('hex');
}

function calculateCrashPoint(sSeed, cSeed, n) {
    const hash = crypto.createHmac('sha256', sSeed)
                       .update(`${cSeed}-${n}`)
                       .digest('hex');

    const h = parseInt(hash.substring(0, 8), 16);
    const crashPoint = Math.floor((100 * 2**32) / (h + 1)) / 100;

    if (crashPoint < 1.01) {
        return 1.00;
    }
    return crashPoint;
}

function startGameCycle() {
    currentGameState = GAME_STATES.WAITING_FOR_BETS;
    players = {};
    multiplier = 1;
    serverSeed = generateRandomHex(64);
    hashedServerSeed = crypto.createHash('sha256').update(serverSeed).digest('hex');
    nonce++;

    console.log(`New round cycle starting. Betting open for ${BETTING_PHASE_DURATION_MS / 1000}s.`);
    io.emit("gameStateChange", { state: currentGameState, hashedServerSeed: hashedServerSeed, nonce: nonce });

    roundTimer = setTimeout(() => {
        startMultiplierPhase();
    }, BETTING_PHASE_DURATION_MS);
}

function startMultiplierPhase() {
    currentGameState = GAME_STATES.GAME_RUNNING;
    gameRunning = true;
    roundStartTime = Date.now();

    const blastAt = calculateCrashPoint(serverSeed, clientSeed, nonce);
    console.log(`Multiplier phase started. Blast at: x${blastAt.toFixed(2)}`);
    io.emit("gameStateChange", { state: currentGameState });

    gameInterval = setInterval(() => {
        const timeElapsed = (Date.now() - roundStartTime) / 1000;
        multiplier = parseFloat(Math.pow(Math.E, timeElapsed * 0.07).toFixed(2));

        if (multiplier >= blastAt) {
            endRound(blastAt);
        } else {
            io.emit("gameUpdate", { multiplier: multiplier });
        }
    }, 100);
}

async function endRound(crashPointOverride = null) {
    if (gameInterval) {
        clearInterval(gameInterval);
        gameInterval = null;
    }
    if (roundTimer) {
        clearTimeout(roundTimer);
        roundTimer = null;
    }

    gameRunning = false;
    currentGameState = GAME_STATES.ROUND_ENDED;

    const finalCrashPoint = crashPointOverride || parseFloat(multiplier.toFixed(2));

    io.emit("roundCrash", {
        crashPoint: finalCrashPoint,
        serverSeed: serverSeed,
        clientSeed: clientSeed,
        nonce: nonce
    });
    console.log(`Game crashed at x${finalCrashPoint}. Server Seed: ${serverSeed}, Client Seed: ${clientSeed}, Nonce: ${nonce}`);

    try {
        for (const socketId in players) {
            const player = players[socketId];
            if (player.inGame && !player.hasCashedOut) {
                console.log(`Player ${socketId} did not cash out and lost their bet.`);
            }
        }

        await Bet.updateMany(
            { status: "placed", serverSeed: serverSeed, nonce: nonce },
            {
                multiplier: finalCrashPoint,
                status: "crashed",
            }
        );
        console.log("Uncashed bets updated to 'crashed' status.");
    } catch (dbErr) {
        console.error("Error updating crashed bets in DB:", dbErr);
    }

    players = {};
    serverSeed = null;
    hashedServerSeed = null;

    io.emit("gameStateChange", { state: currentGameState });
    setTimeout(() => {
        startGameCycle();
    }, ROUND_END_DURATION_MS);
}

startGameCycle();

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    let currentUser;
    User.findOneAndUpdate(
        { socketId: socket.id },
        { $setOnInsert: { balances: { BTC: 5.0, ETH: 100.0, USDT: 50005.00 } } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    )
    .then(user => {
        currentUser = user;
        console.log(`User ${socket.id} (Balances: ${JSON.stringify(currentUser.balances)}) connected.`);
        socket.emit("updateBalances", { balances: currentUser.balances });
        socket.emit("gameStateChange", { state: currentGameState, hashedServerSeed: hashedServerSeed, nonce: nonce });
    })
    .catch(err => console.error("Error finding/creating user:", err));

    socket.on('requestBalances', async () => {
        if (currentUser) {
            const latestUser = await User.findById(currentUser._id);
            if (latestUser) {
                currentUser = latestUser;
                socket.emit("updateBalances", { balances: currentUser.balances });
            }
        }
    });

    socket.on("placeBet", async ({ usdAmount, currency, clientSeed: playerClientSeed }) => {
        if (currentGameState !== GAME_STATES.WAITING_FOR_BETS) {
            socket.emit("betError", { message: "Bets are currently closed." });
            return;
        }

        if (typeof usdAmount !== 'number' || usdAmount <= 0 || !currency) {
            socket.emit("betError", { message: "Invalid bet amount or currency." });
            return;
        }

        if (!currentUser) {
            socket.emit("betError", { message: "User not initialized. Please refresh." });
            return;
        }

        try {
            const usdRate = await getOrFetchCryptoPrice(currency);

            if (!usdRate) {
                socket.emit("betError", { message: "Could not get current currency rate. (API rate limit?)" });
                return;
            }

            const cryptoAmount = usdAmount / usdRate;

            if (currentUser.balances[currency] === undefined || currentUser.balances[currency] < cryptoAmount) {
                socket.emit("betError", { message: `Insufficient ${currency} balance.` });
                return;
            }

            const updatedUser = await User.findOneAndUpdate(
                { socketId: socket.id, [`balances.${currency}`]: { $gte: cryptoAmount } },
                { $inc: { [`balances.${currency}`]: -cryptoAmount } },
                { new: true }
            );

            if (!updatedUser) {
                socket.emit("betError", { message: "Failed to deduct bet amount (possibly insufficient funds or race condition)." });
                return;
            }
            currentUser = updatedUser;
            socket.emit("updateBalances", { balances: currentUser.balances });

            if (playerClientSeed && typeof playerClientSeed === 'string' && playerClientSeed.length > 0) {
                clientSeed = playerClientSeed;
            } else {
                clientSeed = "defaultClientSeed";
            }

            players[socket.id] = {
                usdAmount: usdAmount,
                cryptoAmount: cryptoAmount,
                currency: currency,
                usdRate: usdRate,
                inGame: true,
                hasCashedOut: false,
                userId: currentUser._id
            };

            await Bet.create({
                socketId: socket.id,
                userId: currentUser._id,
                usdAmount: usdAmount,
                cryptoAmount: cryptoAmount,
                currency: currency,
                usdRate: usdRate,
                status: "placed",
                serverSeed: serverSeed,
                clientSeed: clientSeed,
                nonce: nonce,
            });

            console.log(`Bet saved: $${usdAmount} USD (${cryptoAmount.toFixed(6)} ${currency}) by ${socket.id}`);

            await Transaction.create({
                userId: currentUser._id,
                socketId: socket.id,
                usdAmount: usdAmount,
                cryptoAmount: cryptoAmount,
                currency: currency,
                transactionType: 'bet',
                transactionHash: generateRandomHex(32),
                priceAtTime: usdRate,
                timestamp: new Date()
            });
            console.log(`Transaction logged for bet by ${socket.id}`);

            socket.emit("betAccepted");

        } catch (err) {
            console.error("Error placing bet:", err);
            socket.emit("betError", { message: "Failed to place bet due to server error. Please try again." });
        }
    });

    socket.on("cashOut", async () => {
        const player = players[socket.id];

        console.log(`Cash out attempt by ${socket.id}.`);
        console.log(`  - Game Running: ${gameRunning}`);
        console.log(`  - Player Object Exists: ${!!player}`);
        if (player) {
            console.log(`  - Player inGame: ${player.inGame}`);
            console.log(`  - Player hasCashedOut: ${player.hasCashedOut}`);
            console.log(`  - Player cryptoAmount: ${player.cryptoAmount}`);
            console.log(`  - Current Multiplier: ${multiplier}`);
        } else {
            console.log("  - Player object is null/undefined.");
        }

        if (!gameRunning || !player || !player.inGame || player.hasCashedOut) {
            console.warn(`Cash out blocked for ${socket.id}. Conditions: gameRunning=${gameRunning}, player=${!!player}, inGame=${player?.inGame}, hasCashedOut=${player?.hasCashedOut}`);
            socket.emit("cashOutError", { message: "Cannot cash out at this moment (game not running or already cashed out/lost)." });
            return;
        }

        player.hasCashedOut = true;
        player.inGame = false;

        const cryptoPayout = player.cryptoAmount * multiplier;
        const usdEquivalent = parseFloat((cryptoPayout * player.usdRate).toFixed(2));

        console.log(`${socket.id} cashed out at x${multiplier.toFixed(2)}. Winnings: ${cryptoPayout.toFixed(6)} ${player.currency} ($${usdEquivalent})`);

        io.emit("playerCashout", {
            playerId: socket.id,
            amount: cryptoPayout,
            currency: player.currency,
            usd: usdEquivalent,
            multiplier: parseFloat(multiplier.toFixed(2)),
        });

        try {
            const updatedUser = await User.findOneAndUpdate(
                { socketId: socket.id },
                { $inc: { [`balances.${player.currency}`]: cryptoPayout } },
                { new: true }
            );
            if (updatedUser) {
                currentUser = updatedUser;
                socket.emit("updateBalances", { balances: currentUser.balances });
                console.log(`User ${socket.id} balance updated. New balance: ${currentUser.balances[player.currency].toFixed(6)} ${player.currency}`);
            } else {
                console.error(`Failed to find and update user ${socket.id} balance during cash out.`);
                socket.emit("cashOutError", { message: "Failed to update your balance in the database." });
            }

            const updatedBet = await Bet.findOneAndUpdate(
                { socketId: socket.id, status: "placed", serverSeed: serverSeed, nonce: nonce },
                {
                    payoutCrypto: cryptoPayout,
                    payoutUSD: usdEquivalent,
                    multiplier: parseFloat(multiplier.toFixed(2)),
                    status: "cashedOut",
                },
                { new: true }
            );
            if (updatedBet) {
                console.log(`Bet for ${socket.id} updated to 'cashedOut' in DB.`);
            } else {
                console.error(`Failed to find and update bet for ${socket.id} during cash out. Bet might have already crashed.`);
                socket.emit("cashOutError", { message: "Your bet could not be marked as cashed out. It might have crashed." });
            }

            await Transaction.create({
                userId: currentUser._id,
                socketId: socket.id,
                usdAmount: usdEquivalent,
                cryptoAmount: cryptoPayout,
                currency: player.currency,
                transactionType: 'cashout',
                transactionHash: generateRandomHex(32),
                priceAtTime: player.usdRate,
                timestamp: new Date()
            });
            console.log(`Transaction logged for cashout by ${socket.id}`);

        } catch (dbErr) {
            console.error("Critical error during cash-out DB operations:", dbErr);
            socket.emit("cashOutError", { message: "A critical server error occurred during cash out." });
        }
    });

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
        if (players[socket.id]) {
            players[socket.id].inGame = false;
        }
        delete players[socket.id];
    });
});

server.listen(3000, () =>
    console.log("Server started on http://localhost:3000")
);
