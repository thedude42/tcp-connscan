"use strict";

/*
 * portscanner.js
 * Performs "connect scan" against all 2^16-1 TCP ports using concurrent
 * worker processes, the number of which equals the number of processes
 * reported by the system.
 *
 * Upon completion the open ports are listed with their resolved service
 * names, and the number of closed (received a TCP RST packet) and filtered
 * (connection timed out) ports are reported in no detial.
 *
 * Usage:
 *
 * portscanner.js <address>
 *
 * address can be ipv4, ipv6 or name which local resolver can handle
 */

var child_process = require("child_process"),
    fs = require("fs"),
    readline = require("readline"),
    path = require("path");


// Constants
//resolve path to "childscanner.js" needed for proper npm package behavior
var SCANNER_MODULE = path.join(path.dirname(fs.realpathSync(__filename)), './childscanner.js'),
    CORES = require("os").cpus().length;

// Module vars
var mod = {
    WORKERS: CORES,
    children: [],
    results: {
        open:[],
        closed:[],
        filtered:[],
        scanned:[]
    },
    FISHY_ADDRESS: false,
    ServicesDBTcp: {},
    START_PORT: 1,
    END_PORT: 65535,
    ADDR: false,
};
mod.NUM_PORTS = setNumPorts();
mod.guard = workersGate(mod.WORKERS);

// exports for testing
module.exports.mod = mod;

function setNumPorts(start, end) {
    if (arguments.length === 0) {
        return  mod.END_PORT - mod.START_PORT + 1;
    }
    else if (isNaN(start) || isNaN(end) || start <= 0 || end > 65535) {
        return mod.NUM_PORTS;
    }
    else if ((end - start) < 0) {
        return mod.NUM_PORTS;
    }
    else {
        mod.START_PORT = start;
        mod.END_PORT = end;
        mod.NUM_PORTS = mod.END_PORT - mod.START_PORT + 1;
        return {start:mod.START_PORT,end:mod.END_PORT,numports:mod.NUM_PORTS};
    }
}
module.exports.setNumPorts = setNumPorts;

function countResults() {
    return mod.results.open.length+
           mod.results.closed.length+
           mod.results.filtered.length;
}
module.exports.countResults = countResults;

// initializes one child per WORKERS
module.exports.beginScan = function beginScan(addr) {
    mod.ADDR = addr;
    exports.initServicesObject(mod.ServicesDBTcp, scanInit);
    console.log("Starting",exports.WORKERS,"child processes for scanning address",mod.ADDR,"for ports",mod.START_PORT,"thru",mod.END_PORT,":",mod.NUM_PORTS,"ports");
};

// simple creation of an object to map ports to service names
// and call callback function cb when complete
module.exports.initServicesObject = function initServicesObject(obj, cb) {
    var record_regex = /(\S+)\s+(\d+)\/tcp.+/,
        filestream = fs.createReadStream("/etc/services"),
        rl = readline.createInterface({terminal:false, input:filestream});
    rl.on("line", function(line) {
        var m = record_regex.exec(line);
        if (m) {
            obj[m[2]] = m[1];
        }
    });
    filestream.on("close", cb);
    filestream.on("error", function(e) {
        console.log("could not open /etc/services : ",e);
    });
};

// private function to launch worker processes
function scanInit() {
    if (!mod.ADDR) {
        console.log("Address is not set");
        return undefined;
    }
    for (var i = 0; i < mod.WORKERS; ++i) {
        var child = exports.forkChildProcess(SCANNER_MODULE);
        child.num = i;
        mod.children[i] = exports.initChild(child);
    }
    return mod.children;
}

module.exports.forkChildProcess = function forkChildProcess(modulename) {
    return child_process.fork(path.resolve(modulename));
};

function initChild(child) {
    child.assigned = {};
    child.on("error", function parentErrorHandler(e) {
        console.log("Child", child.num, "errored:", e);
    });
    child.on("exit", function parentExitHandler(e) {
        console.log("Child", child.num, "exited:", e);
        var waiting = [],
            assigned = Object.keys(child.assigned);
        for (var i = 0; i < assigned.length; ++i) {
            if (child.assigned[assigned[i]] === "waiting") {
                waiting.push(assigned[i]);
            }
        }
        if (waiting.length > 0) {
            console.log("restarting child",child.num);
            var new_child = exports.forkChildProcess(SCANNER_MODULE);
            new_child.num = child.num;
            mod.children[new_child.num] = new_child;
            initChild(new_child, waiting);
        }
        else {
            mod.guard();
        }
    });
    child.on("message", function parentMsgHandler(msg) {
        if (msg.state === "open") {
            mod.results.open.push(msg.port+": "+mod.ServicesDBTcp[msg.port]);
        }
        else if (msg.state === "closed") {
            mod.results.closed.push(msg.port);
        }
        else if (msg.state === "filtered") {
            mod.results.filtered.push(msg.port);
        }
        mod.results.scanned[msg.port] = true;
        child.assigned[msg.port] = "scanned";
        // All work complete case
        if (countResults() >= mod.NUM_PORTS) {
            child.lastworker = true;
            console.log("DISCONNECTING",mod.children.length,"CHILDREN");
            mod.children.forEach(function(c) {
                c.disconnect();
            });
            // If the math doesn't add up, throw, this is a bug
            if (countResults() !== mod.NUM_PORTS) {
                throw new Error("We somehow counted more work than we were supposed to do");
            }
        }
    });
    // default path
    if (arguments.length < 2) {
        console.log("Sending port messages to child",child.num);
        for (var port = mod.START_PORT+child.num; port <= mod.END_PORT; port += mod.WORKERS) {
            child.send({port:port,addr:mod.ADDR});
            child.assigned[port] = "waiting";
        }
    } // restarting failed child with "waiting" ports array argument
    else {
        console.log("re-initializing child",child.num); 
        arguments[1].forEach(function(port) {
            child.send({port:port,addr:mod.ADDR});
            child.assigned[port] = "waiting";
        });
    }
    return child;
}
module.exports.initChild = initChild;

/*
 * function maker, returns a counter function meant to be called upon each
 * child worker process port connect attempt, initialized with the number of 
 * expected tasks to complete.  Prints the results report when counter
 * matches numtasks.
 */

function workersGate(numtasks) {
    var count = 0;
    return function() {
        count++;
        if (count == numtasks) {
            console.log("\n-=- results -=-\n");
            if (mod.FISHY_ADDRESS) {
                console.log("** WARNING: Unreliable scan, fishy address:",mod.ADDR,"**\n");
            }
            if (mod.results.open.length) {
                console.log("open TCP mod.ports:\n",JSON.stringify(mod.results.open,null,2));
            }
            else  {
                console.log("No open ports");
            }
            console.log(mod.results.filtered.length, "ports timed out (filtered|closed|lost)");
            console.log(mod.results.closed.length, "ports are closed");
            return true;
        }
        else if (count < numtasks) {
            return count;
        }
        else {
            return false;
        }
    };
}
module.exports.workersGate = workersGate;
