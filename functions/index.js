const admin = require('firebase-admin')

admin.initializeApp()

exports.onReceiptUploaded = require('./onReceiptUploaded')
exports.onExpenseChange = require('./onExpenseChange')
exports.reanalyzeReceipt = require('./reanalyzeReceipt')
