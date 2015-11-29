#! /usr/bin/env node

var scanner = require("../scannerlib"),
    dns = require("dns"),
    path = require("path");

if (process.argv.length < 3) {
    console.log("Please supply an address to scan\n\nusage:\n\t", path.basename(process.argv[1]), "<address>");
    process.exit(1);
}

var ADDR = process.argv[2];

// Perform lookup on addr input arg, then init the services DB and start scan
dns.lookup(ADDR, function onDnsLookup(err, address, fam) {
    if (err) {
        console.log("Unable to resolve", ADDR);
        process.exit(1);
    }
    else {
        if ( /^0\..+$/.test(address)) {
            console.log("bogon address:",address);
            process.exit(1);
        }
        scanner.beginScan(address);
    }
});


