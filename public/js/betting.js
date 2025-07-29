window.placeBetBtn.onclick = () => {
    const usdAmount = parseFloat(window.betInput.value);
    const currency = window.currencySelect.value;
    const clientSeed = window.clientSeedInput.value;

    if (usdAmount > 0) {
        window.placeBetBtn.disabled = true; // Disable immediately on click
        window.socket.emit("placeBet", { usdAmount, currency, clientSeed });
    } else {
        alert("Please enter a valid bet amount (greater than 0).");
        window.placeBetBtn.disabled = false;
    }
};

window.cashOutBtn.onclick = () => {
    window.cashOutBtn.disabled = true; // Disable immediately on click
    window.socket.emit("cashOut");
};
