const Canvas = require('canvas');
const fs = require('fs');
const path = require('path');

exports.drawCoinProfit = async (profitData, privacyMode) => {

    let totalInvestedSolAmount = profitData.totalInvestedSolAmount;
    let totalReturnedSolAmount = profitData.totalReturnedSolAmount;
    let profitSolValue = profitData.profitSolValue;

    if (privacyMode) {
        const privacy_string = '-';
        totalInvestedSolAmount = privacy_string;
        totalReturnedSolAmount = privacy_string;
        profitSolValue = privacy_string;
    }

    const clean_discord = profitData.username.replace(/[\u{1F000}-\u{1FFFF}]/gu, '');

    // Dimensions for the image
    const width = 2551;
    const height = 2551;

    // Register assets fonts
    Canvas.registerFont('./utils/saira/Saira-Bold.ttf', { family: 'Saira-Bold' });
    Canvas.registerFont('./utils/saira/Saira-SemiBold.ttf', { family: 'Saira-SemiBold' });

    // Instantiate the canvas object
    const canvas = Canvas.createCanvas(width, height);
    const context = canvas.getContext('2d');

    const image = Canvas.Image;
    const img = new image();
    img.src = './assets/coins.jpg';

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Set the style of the test and render it to the canvas
    const color_green = '#85D028';
    const color_white = '#ffffff';
    context.textAlign = 'center';
    context.fillStyle = color_white;
    // 600 is the x value (the center of the image)
    // 170 is the y (the top of the line of text)
    context.font = '92pt \'Saira-SemiBold\'';
    context.fillText(profitData.symbol, 1275.5, 620);

    context.font = '60pt \'Saira-SemiBold\'';
    context.textAlign = 'right';
    const numbers_y_value = 1850;

    context.fillText(totalInvestedSolAmount, numbers_y_value, 890);
    context.fillText(totalReturnedSolAmount, numbers_y_value, 1010);

    context.font = '230pt \'Saira-Bold\'';
    context.textAlign = 'center';
    context.fillStyle = color_green;
    context.shadowColor = color_green;
    context.shadowBlur = 30;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 0;
    context.fillText(profitData.profitPercentage, 1275.5, 1600);
    context.shadowColor = 'transparent';
    context.shadowBlur = 0;

    context.font = '60pt \'Saira-SemiBold\'';
    context.textAlign = 'center';
    context.fillStyle = color_white;
    const multiplier = profitData.multiplier;
    let profitUsdValue = profitData.profitUsdValue;
    if (privacyMode) {
        profitUsdValue = '-';
    }
    context.fillText(multiplier, 690, 1825);
    context.fillText(profitSolValue, 1275.5, 1825);
    context.fillText(profitUsdValue, 1880, 1825);

    const canvasWidth = 2551;
    const avatarWidth = 125;
    const avatarHeight = 125;
    const textWidth = context.measureText(clean_discord).width;
    const centerX = (canvasWidth - (avatarWidth + textWidth)) / 2;

    if (profitData.profileImg) {
        try {
            const imageUrl = profitData.profileImg;
            const externalImage = await Canvas.loadImage(imageUrl);

            const avatarX = centerX - 60;
            const avatarY = 2050 + (avatarHeight / 2);

            // Save the current canvas state
            context.save();

            // Create a circular clipping path
            context.beginPath();
            context.arc(avatarX + avatarWidth / 2, avatarY, avatarWidth / 2, 0, Math.PI * 2);
            context.closePath();
            context.clip();

            // Draw the rounded external image (avatar) on the canvas
            context.drawImage(externalImage, avatarX, 2050, avatarWidth, avatarHeight);

            // Reset the clipping path
            context.restore();
        } catch (e) {
            console.log('Error loading discord avatar', e);
        }
    }
    context.font = '45pt \'Saira-SemiBold\'';
    context.fillStyle = color_white;
    context.fillText(clean_discord, 1275.5, 2140);

    // Write the image to file
    const buffer = canvas.toBuffer('image/jpeg');
    const tempDir = path.resolve(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
    const file_path = path.join(tempDir, Date.now() + '.jpeg');
    fs.writeFileSync(file_path, buffer);

    return file_path;
};