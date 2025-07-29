async function fetchAndDisplayCryptoToUSD() {
    const selectedCurrencyId = window.currencySelect.value;
    try {
        const response = await fetch(`/convert/${selectedCurrencyId}`);
        const data = await response.json();

        if (data.usd) {
            window.currentCryptoPrices[selectedCurrencyId] = data.usd;

            const usdAmount = parseFloat(window.betInput.value);
            if (!isNaN(usdAmount) && usdAmount > 0) {
                const cryptoEquivalent = (usdAmount / window.currentCryptoPrices[selectedCurrencyId]);
                window.betCryptoEquivalentSpan.innerText = `(${cryptoEquivalent.toFixed(6)} ${selectedCurrencyId.toUpperCase().substring(0, 3)})`;
            } else {
                window.betCryptoEquivalentSpan.innerText = "";
            }
        } else {
            console.error(`Failed to get USD rate for ${selectedCurrencyId}. Error:`, data.error || "Unknown");
            window.betCryptoEquivalentSpan.innerText = "(N/A)";
        }
    } catch (error) {
        console.error("Error fetching crypto conversion:", error);
        window.betCryptoEquivalentSpan.innerText = "(Error)";
    }
}

fetchAndDisplayCryptoToUSD();

window.currencySelect.addEventListener("change", fetchAndDisplayCryptoToUSD);

window.betInput.addEventListener("input", fetchAndDisplayCryptoToUSD);
