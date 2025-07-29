const socket = io();

window.socket = socket;
window.placeBetBtn = document.getElementById("place-bet");
window.cashOutBtn = document.getElementById("cash-out");
window.betInput = document.getElementById("bet-input");
window.currencySelect = document.getElementById("currency-select");
window.statusDisplay = document.getElementById("status");
window.cashoutLog = document.getElementById("cashout-log");
window.userBalanceBTCSpan = document.getElementById("user-balance-btc");
window.userBalanceETHSpan = document.getElementById("user-balance-eth");
window.userBalanceUSDTSpan = document.getElementById("user-balance-usdt");
window.totalUsdEquivalentSpan = document.getElementById("total-usd-equivalent");
window.betCryptoEquivalentSpan = document.getElementById("bet-crypto-equivalent");
window.hashedServerSeedDisplay = document.getElementById("hashed-server-seed");
window.clientSeedInput = document.getElementById("client-seed-input");
window.nonceDisplay = document.getElementById("nonce-display");
window.revealedServerSeedDisplay = document.getElementById("revealed-server-seed");
window.verifyRoundBtn = document.getElementById("verify-round-btn");
window.verificationResultDisplay = document.getElementById("verification-result");
window.roundHistoryTableBody = document.querySelector("#round-history-table tbody");

let lastRoundData = {};
window.currentCryptoPrices = {};

function calculateCrashPointClient(serverSeed, clientSeed, nonce) {
    const hash = CryptoJS.HmacSHA256(`${clientSeed}-${nonce}`, serverSeed).toString();
    const h = parseInt(hash.substring(0, 8), 16);
    const crashPoint = Math.floor((100 * 2**32) / (h + 1)) / 100;
    if (crashPoint < 1.01) {
        return 1.00;
    }
    return crashPoint;
}

async function fetchRoundHistory() {
    try {
        const response = await fetch("/api/round-history");
        const history = await response.json();

        window.roundHistoryTableBody.innerHTML = "";

        history.forEach((round, index) => {
            const row = window.roundHistoryTableBody.insertRow();
            row.insertCell().innerText = history.length - index;
            row.insertCell().innerText = `x${round.crashPoint.toFixed(2)}`;
            row.insertCell().innerText = round.serverSeed ? `${round.serverSeed.substring(0, 8)}...` : 'N/A';
            row.insertCell().innerText = round.clientSeed || 'N/A';
            row.insertCell().innerText = round.nonce;
            row.insertCell().innerText = new Date(round.timestamp).toLocaleTimeString();
        });
    } catch (error) {
        console.error("Error fetching round history:", error);
    }
}

function updateBalanceDisplay(balances) {
    window.userBalanceBTCSpan.innerText = `${balances.BTC.toFixed(6)} BTC`;
    window.userBalanceETHSpan.innerText = `${balances.ETH.toFixed(6)} ETH`;
    window.userBalanceUSDTSpan.innerText = `${balances.USDT.toFixed(2)} USDT`;

    let totalUsd = 0;
    if (window.currentCryptoPrices.bitcoin) totalUsd += balances.BTC * window.currentCryptoPrices.bitcoin;
    if (window.currentCryptoPrices.ethereum) totalUsd += balances.ETH * window.currentCryptoPrices.ethereum;
    if (window.currentCryptoPrices.tether) totalUsd += balances.USDT * window.currentCryptoPrices.tether;
    window.totalUsdEquivalentSpan.innerText = `($${totalUsd.toFixed(2)} USD)`;
}

socket.on("connect", () => {
    console.log("Connected to server via Socket.IO");
    // Initial state on connect
    window.placeBetBtn.disabled = true; // Disabled initially until game state is WAITING_FOR_BETS
    window.cashOutBtn.disabled = true;
    window.statusDisplay.innerText = "Connecting...";
    if (typeof window.resetGraph === 'function') {
        window.resetGraph();
    }
    fetchRoundHistory();
});

socket.on("gameStateChange", ({ state, hashedServerSeed: hs, nonce: n }) => {
    window.statusDisplay.innerText = state.replace(/_/g, ' ');
    if (state === 'WAITING_FOR_BETS') {
        window.placeBetBtn.disabled = false;
        window.cashOutBtn.disabled = true;
        if (typeof window.resetGraph === 'function') {
            window.resetGraph();
        }
        window.hashedServerSeedDisplay.innerText = hs;
        window.nonceDisplay.innerText = n;
        window.revealedServerSeedDisplay.innerText = "N/A";
        window.verificationResultDisplay.innerText = "";
        lastRoundData = {};
    } else if (state === 'GAME_RUNNING') {
        window.placeBetBtn.disabled = true;
        // Cash out button enabled if player has a bet in game, handled by betAccepted
    } else if (state === 'ROUND_ENDED') {
        window.placeBetBtn.disabled = true;
        window.cashOutBtn.disabled = true;
    }
});

socket.on("gameUpdate", ({ multiplier }) => {
    window.statusDisplay.innerText = `x${multiplier.toFixed(2)}`;
    if (typeof window.updateGraph === 'function') {
        window.updateGraph(multiplier);
    } else {
        console.error("window.updateGraph is not a function!");
    }
});

socket.on("roundCrash", ({ crashPoint, serverSeed, clientSeed, nonce }) => {
    window.statusDisplay.innerText = `💥 Game Over at x${crashPoint}`;
    if (typeof window.updateGraph === 'function') {
        window.updateGraph(crashPoint);
    }
    window.revealedServerSeedDisplay.innerText = serverSeed;
    lastRoundData = {
        crashPoint: crashPoint,
        serverSeed: serverSeed,
        clientSeed: clientSeed,
        nonce: nonce
    };
    fetchRoundHistory();
    // Ensure buttons are reset after crash
    window.placeBetBtn.disabled = true; // Will be enabled by gameStateChange (WAITING_FOR_BETS)
    window.cashOutBtn.disabled = true;
});

socket.on("betAccepted", () => {
    window.statusDisplay.innerText = "Bet placed! Waiting for round to start...";
    window.placeBetBtn.disabled = true;
    window.cashOutBtn.disabled = false; // Enable cash out if bet accepted
});

socket.on("betError", ({ message }) => {
    window.statusDisplay.innerText = `Bet Error: ${message}`;
    window.placeBetBtn.disabled = false; // Re-enable if error
    window.cashOutBtn.disabled = true;
    console.error("Bet Error from server:", message);
});

socket.on("cashOutError", ({ message }) => {
    window.statusDisplay.innerText = `Cash Out Error: ${message}`;
    console.error("Cash Out Error from server:", message);
    window.cashOutBtn.disabled = false; // Re-enable cash out button if error
});

socket.on("playerCashout", ({ playerId, amount, currency, usd, multiplier }) => {
    const listItem = document.createElement("li");
    listItem.innerText = `${playerId.substring(0, 4)}... cashed out at x${multiplier} for ${amount.toFixed(6)} ${currency} ($${usd.toFixed(2)})`;
    window.cashoutLog.prepend(listItem);
    if (window.cashoutLog.children.length > 5) {
        window.cashoutLog.removeChild(window.cashoutLog.lastChild);
    }
});

socket.on("updateBalances", ({ balances }) => {
    updateBalanceDisplay(balances);
});

socket.on("latestPrices", ({ prices }) => {
    window.currentCryptoPrices = prices;
    socket.emit('requestBalances');
});


socket.on("disconnect", () => {
    window.statusDisplay.innerText = "Disconnected from server. Retrying...";
    window.placeBetBtn.disabled = true;
    window.cashOutBtn.disabled = true;
});

if (window.verifyRoundBtn) {
    window.verifyRoundBtn.onclick = () => {
        if (!lastRoundData.serverSeed) {
            window.verificationResultDisplay.innerText = "No round data to verify.";
            return;
        }

        const clientCalculatedCrash = calculateCrashPointClient(
            lastRoundData.serverSeed,
            lastRoundData.clientSeed,
            lastRoundData.nonce
        );

        if (clientCalculatedCrash === lastRoundData.crashPoint) {
            window.verificationResultDisplay.innerText = `✅ Verified! Client calculated: x${clientCalculatedCrash}`;
            window.verificationResultDisplay.style.color = "green";
        } else {
            window.verificationResultDisplay.innerText = `❌ Verification FAILED! Client calculated: x${clientCalculatedCrash}, Server reported: x${lastRoundData.crashPoint}`;
            window.verificationResultDisplay.style.color = "red";
        }
    };
}
