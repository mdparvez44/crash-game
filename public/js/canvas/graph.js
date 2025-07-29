const canvas = document.getElementById("graph");
const ctx = canvas.getContext("2d");

const width = canvas.width;
const height = canvas.height;

const scaleX = 30;
const scaleY = 40;

const displayMaxX = 20;
const displayMaxY = 10;

let graphPoints = [];

function drawStaticGraphElements() {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "white";
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(0, height);
    ctx.lineTo(width, height);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, height);
    ctx.stroke();

    ctx.fillStyle = "white";
    ctx.font = "10px Arial";

    for (let i = 0; i <= displayMaxX; i += 1) {
        const x = i * scaleX;
        if (x > width) break;
        ctx.beginPath();
        ctx.moveTo(x, height);
        ctx.lineTo(x, height - 5);
        ctx.stroke();
        ctx.fillText(i.toString(), x + 2, height - 8);
    }

    for (let i = 0; i <= displayMaxY; i += 1) {
        const y = height - i * scaleY;
        if (y < 0) break;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(5, y);
        ctx.stroke();
        ctx.fillText(i.toString(), 6, y - 2);
    }
}

drawStaticGraphElements();

function updateGraph(currentMultiplier) {
    const maxGraphMultiplier = 100;
    // Calculate xCoord based on a visual scaling, not just graphPoints.length
    // This makes the graph progression visually consistent with multiplier growth
    const xCoord = (currentMultiplier / maxGraphMultiplier) * width;
    const yCoord = height - (currentMultiplier * scaleY);

    // Only add a point if it's new or if the multiplier has increased enough
    // to warrant a new point on the graph.
    // This prevents adding duplicate points or points that are too close.
    if (graphPoints.length === 0 || xCoord > graphPoints[graphPoints.length - 1].x) {
        if (xCoord <= width) {
            graphPoints.push({ x: xCoord, y: yCoord });
        } else {
            // If the multiplier goes beyond the visual maxGraphMultiplier,
            // extend the line to the edge of the canvas.
            // Ensure the last point is at the right edge of the canvas.
            if (graphPoints[graphPoints.length - 1].x < width) {
                graphPoints.push({ x: width, y: height - (currentMultiplier * scaleY) });
            }
        }
    }

    drawStaticGraphElements();

    ctx.strokeStyle = "lime";
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(0, height);
    graphPoints.forEach(point => {
        ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();

    if (graphPoints.length > 0) {
        const lastPoint = graphPoints[graphPoints.length - 1];
        ctx.fillStyle = "red";
        ctx.beginPath();
        ctx.arc(lastPoint.x, lastPoint.y, 5, 0, 2 * Math.PI);
        ctx.fill();
    }
}

function resetGraph() {
    graphPoints = [];
    drawStaticGraphElements();
}

window.updateGraph = updateGraph;
window.resetGraph = resetGraph;
