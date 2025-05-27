require('dotenv').config();
const ecpay_payment = require('ecpay_aio_nodejs')
const config = require('../config/index')

const options = {
  "OperationMode": "Test", //Test or Production
  "MercProfile": {
    "MerchantID": config.get('ecpay.merchantID'),
    "HashKey": config.get('ecpay.hashKey'),
    "HashIV": config.get('ecpay.hashIV')
  },
  "ChoosePayment": "ALL",
  "IgnorePayment": [
    "ATM",
    "CVS",
    "BARCODE",
    "AndroidPay",
    "TWQR",
    "ApplePay",
    "BNPL",
    "WeiXin"
  ],
  "IsProjectContractor": false
}

function getCurrentDateTimeFormatted() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0'); // Month is 0-indexed
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}

function prepareECPayData(order) {
  const BACKEND_HOST = config.get('ecpay.backendHost')
  console.log('=============================== backend_host: ', BACKEND_HOST)
  console.log('=============================== return url: ', '${BACKEND_HOST}/api/order/ecpay-result')
  const FRONTEND_HOST = config.get('ecpay.frontendHost')
  // const no = `${order.id}_001`
  const time = getCurrentDateTimeFormatted()
  const base_param = {
    MerchantTradeNo: order.id,
    MerchantTradeDate: time,
    TotalAmount: order.price,
    TradeDesc: order.description || '測試交易描述',
    ItemName: '測試訂單',
    ReturnURL: `${BACKEND_HOST}/api/order/ecpay-result`,
    ClientBackURL: `${FRONTEND_HOST}/become-a-sitter`, // 消費者點選此按鈕後，會將頁面導回到此設定的網址
    // OrderResultURL: '${FRONTEND_HOST}/payment_result', // 有別於ReturnURL (server端的網址)，OrderResultURL為特店的client端(前端)網址。消費者付款完成後，綠界會將付款結果參數以POST方式回傳到到該網址。詳細說明請參考付款結果通知。; 若與[ClientBackURL]同時設定，將會以此參數為主
    CustomField1: order.id
  }

  const create = new ecpay_payment(options)
  const html = create.payment_client.aio_check_out_all(base_param)

  return html
}

module.exports = {
  prepareECPayData
}