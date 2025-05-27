const admin = require('firebase-admin')

admin.initializeApp()

exports.onReceiptUploaded = require('./onReceiptUploaded')
