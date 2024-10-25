import plugin from '../../lib/plugins/plugin.js';  
import fetch from 'node-fetch';  

// 百度API信息  
const BAIDU_API_KEY = 'ak';  
const BAIDU_SECRET_KEY = 'sk';  
const OCR_API = 'https://aip.baidubce.com/rest/2.0/ocr/v1/general';  
const TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token';  
const LOTTERY_API = 'http://api.huiniao.top/interface/home/lotteryHistory';  

// 记录触发的用户 ID 和定时器  
let activeUserId = null;  
let timeoutId = null;  

// 插件类  
export class LotteryAndOCRPlugin extends plugin {  
    constructor() {  
        super({  
            name: '彩票查询与图片识别',  
            dsc: '查询彩票开奖信息并进行图片识别',  
            event: 'message',  
            priority: 100,  
            rule: [  
                { reg: '^#彩票$', fnc: 'startLotteryQuery' },  
                { reg: '^#?(dlt|ssq).*$', fnc: 'lottery' },  
                { reg: '', fnc: 'onImageReceived' } // 处理图像消息  
            ]  
        });  
    }  

    async startLotteryQuery(e) {  
        // 设置触发查询的用户 ID  
        activeUserId = e.user_id;  
        await e.reply('请发送彩票的图片或相关信息');  
        this.startTimeout(e); // 启动定时器  
    }  

    async onImageReceived(e) {  
        // 检查消息发送者是否为当前激活的用户  
        if (e.user_id !== activeUserId) {  
            return; // 如果不是，直接返回，忽略消息  
        }  

        // 重置定时器  
        this.resetTimeout(e);  

        const imageData = e.message.find(item => item.type === 'image');  
        if (imageData) {  
            const imageUrl = imageData.url;  
            if (imageUrl) {  
                console.log(`接收到图片 URL: ${imageUrl}`);  
                try {  
                    const imageBase64 = await this.getImageBase64(imageUrl);  
                    const accessToken = await this.getAccessToken();  
                    const ocrResult = await this.recognizeImage(accessToken, imageBase64);  
                    console.log('OCR识别结果:', ocrResult);  
                    await this.processOcrResult(e, ocrResult);  // 处理OCR结果  
                } catch (error) {  
                    console.error('发生错误:', error.message);  
                    e.reply(`发生错误: ${error.message}`);  
                }  
            } else {  
                e.reply('未能获取图片数据');  
            }  
        } else {  
            e.reply('请确认你发送的是图片');  
        }  
    }  

    startTimeout(e) {  
        // 设置 1 分钟的定时器  
        timeoutId = setTimeout(() => {  
            e.reply('溜了溜了');  
            this.resetState(); // 重置状态  
        }, 60000);  
    }  

    resetTimeout(e) {  
        clearTimeout(timeoutId);  
        this.startTimeout(e); // 重新启动定时器  
    }  

    resetState() {  
        activeUserId = null;  
        clearTimeout(timeoutId);  
    }  

    async getImageBase64(imageUrl) {  
        const response = await fetch(imageUrl);  
        const buffer = await response.buffer();  
        return buffer.toString('base64');  
    }  

    async getAccessToken() {  
        const response = await fetch(`${TOKEN_URL}?grant_type=client_credentials&client_id=${BAIDU_API_KEY}&client_secret=${BAIDU_SECRET_KEY}`);  
        if (!response.ok) {  
            throw new Error(`获取Access Token失败: ${response.status}`);  
        }  
        const data = await response.json();  
        return data.access_token;  
    }  

    async recognizeImage(accessToken, imageBase64) {  
        const body = new URLSearchParams();  
        body.append('image', imageBase64);  
      
        const response = await fetch(OCR_API + '?access_token=' + accessToken, {  
            method: 'POST',  
            headers: {  
                'Content-Type': 'application/x-www-form-urlencoded',  
            },  
            body: body,  
        });  

        if (!response.ok) {  
            const errorText = await response.text();  
            throw new Error(`HTTP错误! 状态: ${response.status}, 响应: ${errorText}`);  
        }  

        const result = await response.json();
        if (result.error_code) {  
            throw new Error(`OCR API错误: ${result.error_msg}`);  
        }  

        return result;  
    }  


    async processOcrResult(e, ocrResult) {
        if (!ocrResult || !ocrResult.words_result) {
            e.reply('未能识别任何文字，请重新上传图片。');
            return;
        }

        const wordsArray = ocrResult.words_result.map(item => item.words);
        console.log('识别的文字结果:', wordsArray.join(', '));

        // 判断是双色球还是超级大乐透
        if (wordsArray.some(word => word.includes('双色球'))) {
            // 处理双色球
            this.processSsqResult(e, wordsArray);
        } else if (wordsArray.some(word => word.includes('大乐透') || word.includes('超级大乐透'))) {
            // 处理超级大乐透
            this.processDltResult(e, wordsArray);
        } else {
            e.reply('未能识别彩票类型，请检查图片内容。');
        }
    }

    async processSsqResult(e, wordsArray) {
        const type = wordsArray.find(word => word.includes('双色球'));
        const periodMatch = wordsArray.find(word => word.includes('开奖期：'));
        const dateMatch = wordsArray.find(word => word.includes('开奖日期：'));

        // 获取号码
        let numbersParts = [];
        let currentNumber = '';
        let inNumberSection = false;
        wordsArray.forEach(word => {
            if (word.includes('①')) {
                if (inNumberSection && currentNumber.length > 0) {
                    numbersParts.push(currentNumber);
                    currentNumber = '';
                }
                inNumberSection = true;
                currentNumber += word.replace('①', '').trim();
            } else if (word.includes('②') || word.includes('③') || word.includes('④') || word.includes('⑤')) {
                if (currentNumber.length > 0) {
                    numbersParts.push(currentNumber);
                    currentNumber = '';
                }
                inNumberSection = false;
                currentNumber += word.replace(/②|③|④|⑤/g, '').trim();
            } else if (inNumberSection) {
                currentNumber += word;
            }
        });
        if (currentNumber.length > 0) {
            numbersParts.push(currentNumber);
        }

        // 过滤空号码部分
        numbersParts = numbersParts.filter(num => num.length > 0);

        // 获取期号和日期
        const period = periodMatch ? periodMatch.replace('开奖期：', '').trim() : '';
        const date = dateMatch ? dateMatch.replace('开奖日期：', '').replace(/\//g, '').trim() : '';

        if (type && period && date && numbersParts.length > 0) {
            const resultMessage = `票型：${type}; 开奖期：${period}; 开奖日期：${date}; 号码：\n` + numbersParts.map((num, index) => `号码${index + 1}：${num}`).join('\n');
            e.reply(resultMessage);
        } else {
            e.reply('未能识别彩票相关信息，请检查图片内容。');
        }
    }

    async processDltResult(e, wordsArray) {
        const type = wordsArray.find(word => word.includes('大乐透') || word.includes('超级大乐透'));
        const periodMatch = wordsArray.find(word => /第(\d+)期/.test(word));
        const dateMatch = wordsArray.find(word => /\d{4}年\d{1,2}月\d{1,2}日开奖/.test(word));

        // 去除所有非“+”符号和空格的字符
        let cleanedWordsArray = wordsArray.join('').replace(/[^0-9+]/g, '');

        // 获取“元”和“中国体育彩票”之间的数值
        const startIndex = cleanedWordsArray.indexOf('2元');
        const endIndex = cleanedWordsArray.indexOf('中国体育彩票');
        let numberSegment = cleanedWordsArray.slice(startIndex + 2, endIndex);

        // 按10个数值+4个数值整合号码
        let numbersParts = [];
        while (numberSegment.length >= 14) {
            numbersParts.push(numberSegment.slice(0, 10) + '+' + numberSegment.slice(10, 14));
            numberSegment = numberSegment.slice(14);
        }

        // 获取期号和日期
        const period = periodMatch ? periodMatch.replace(/第(\d+)期/, '$1').trim() : '';
        const date = dateMatch ? dateMatch.replace(/[年月日]/g, '').trim() : '';

        if (type && period && date && numbersParts.length > 0) {
            const resultMessage = `票型：${type}; 期号：第${period}期; 开奖时间：${date}; 号码：\n` + numbersParts.map((num, index) => `号码${index + 1}：${num}`).join('\n');
            e.reply(resultMessage);
        } else {
            e.reply('未能识别彩票相关信息，请检查图片内容。');
        }
    }



    async processLotteryCode(e, type, code, numbers) {  
        const lotteryData = await this.getLotteryData(type);  
        const results = lotteryData.results;  
        const matches = this.checkWinning(numbers, results);  

        e.reply(`您的彩票号码: ${numbers.join(', ')}.`);  
        e.reply(`中奖情况: ${matches.join(', ')}`);  
    }  

    async getLotteryData(type) {  
        try {  
            const response = await fetch(`${LOTTERY_API}?type=${type}`);  
            if (!response.ok) {  
                throw new Error(`获取彩票数据失败: ${response.status}`);  
            }  
            const data = await response.json();  
            return data;  
        } catch (error) {  
            console.error('获取彩票数据失败:', error.message);  
            throw error;  
        }  
    }  

    checkWinning(numbers, results) {  
        const winningResults = [];  

        for (const result of results) {  
            const frontMatchCount = this.countMatches(numbers, result.front);  
            const backMatchCount = this.countMatches(numbers, result.back);  
            const prize = this.determinePrize(frontMatchCount, backMatchCount);  
            winningResults.push(prize);  
        }  

        return winningResults;  
    }  

    countMatches(userNumbers, winningNumbers) {  
        return userNumbers.filter(num => winningNumbers.includes(num)).length;  
    }  

    determinePrize(frontMatchCount, backMatchCount) {  
        if (frontMatchCount === 6 && backMatchCount === 1) {  
            return '一等奖';  
        } else if (frontMatchCount === 6) {  
            return '二等奖';  
        } else if (frontMatchCount === 5 && backMatchCount === 1) {  
            return '三等奖';  
        } else if (frontMatchCount === 5 || (frontMatchCount === 4 && backMatchCount === 1)) {  
            return '四等奖';  
        } else if (frontMatchCount === 4 || (frontMatchCount === 3 && backMatchCount === 1)) {  
            return '五等奖';  
        } else if (backMatchCount === 1 || (frontMatchCount === 1 && backMatchCount === 1) || (frontMatchCount === 2 && backMatchCount === 1)) {  
            return '六等奖';  
        } else {  
            return '未中奖';  
        }  
    }  
}
