/*
 * Mock replacement for 'irc'.
 */
"use strict";
var q = require("q");
var EventEmitter = require('events').EventEmitter;

var generatedClients;
var deferredsForClients;

module.exports._reset = function() {
    generatedClients = {
        // addr: {
        //    nick: Client
        // }
    };
    deferredsForClients = {
        // addr_nick: [Deferred, ...]
    };
    module.exports._emitter = new EventEmitter();
};

function Client(addr, nick, opts) {
    // store this instance so tests can grab it and manipulate it.
    if (!generatedClients[addr]) {
        generatedClients[addr] = {};
    }
    generatedClients[addr][nick] = this;
    var that = this;

    // keep a list of the listeners
    var listeners = {};
    this.addListener = jasmine.createSpy("Client.addListener(event, fn)");
    this.addListener.andCallFake(function(event, fn) {
        if (!listeners[event]) {
            listeners[event] = [];
        }
        listeners[event].push(fn);
    });
    this._trigger = function (type, args) {
        if (listeners[type]) {
            listeners[type].forEach(function(listener) {
                listener.apply(this, args);
            });
        }
    };
    this.addr = addr;
    this.nick = nick;

    this.connect = jasmine.createSpy("Client.connect(fn)");
    this.whois = jasmine.createSpy("Client.whois(nick, fn)");
    this.join = jasmine.createSpy("Client.join(channel, fn)");
    this.send = jasmine.createSpy("Client.send(command, args)");
    this.send.andCallFake(function(command, a,b,c,d) {
        module.exports._emitter.emit("send", that, command, a,b,c,d);
    });
    this.action = jasmine.createSpy("Client.action(channel, text)");
    this.action.andCallFake(function(channel, text) {
        module.exports._emitter.emit("action", that, channel, text);
    });
    this.ctcp = jasmine.createSpy("Client.ctcp(channel, kind, text)");
    this.ctcp.andCallFake(function(channel, kind, text) {
        module.exports._emitter.emit("ctcp", that, channel, kind, text);
    });
    this.say = jasmine.createSpy("Client.say(channel, text)");
    this.say.andCallFake(function(channel, text) {
        module.exports._emitter.emit("say", that, channel, text);
    });

    // wrap the spies so they can be used as Deferreds. This allows tests to do
    // things like client._triggerConnect().then(...) which will be resolved
    // whenever the service calls the connect() function or immediately
    // if the service already called connect. This means we don't need to wait
    // for a random amount of time before checking if the call was invoked. In
    // the event that connect() is NOT called, the 'done' timer in the test will
    // fire after 5s (thanks Jasmine!).
    var initInvocationStruct = function(spy, key) {
        // for a given spy function, create a struct which will store the
        // service's callbacks and invoke them,
        // grouped on a key (which may be a concatenation of args).
        if (!spy._invocations) {
            spy._invocations = {}
        }
        if (!spy._invocations[key]) {
            spy._invocations[key] = {
                callbacks: [],
                defer: undefined,
                result: undefined
            }
        }
    };
    var storeCallbackAndMaybeInvoke = function(obj, methodName, key, fn) {
        var spy = obj[methodName];
        // if there is a deferred on this spy waiting, resolve it after calling
        // fn, else add this as a call.
        if (!spy._invocations || !spy._invocations[key]) {
            initInvocationStruct(spy, key);
        }
        
        if (spy._invocations[key].defer) {
            // a test is waiting on this to be called, so call it and resolve
            fn(spy._invocations[key].result);
            spy._invocations[key].defer.resolve(obj);
        }
        else {
            spy._invocations[key].callbacks.push(fn);
        }
    };
    this.connect.andCallFake(function(fn) {
        storeCallbackAndMaybeInvoke(that, "connect", "_", fn);
    });
    this.join.andCallFake(function(channel, fn) {
        storeCallbackAndMaybeInvoke(that, "join", channel, fn);
    });
    this.whois.andCallFake(function(nick, fn) {
        storeCallbackAndMaybeInvoke(that, "whois", nick, fn);
    });
    
    var trigger = function(obj, methodName, key, fnOut) {
        // if there is already a call to methodName, invoke their 'fn's and 
        // return a resolved defer.
        // else add a deferred on this methodName for the fake call to resolve.
        var spy = obj[methodName];
        if (!spy._invocations || !spy._invocations[key]) {
            initInvocationStruct(spy, key);
        }
        if (spy._invocations[key].callbacks.length > 0) { // already called
            spy._invocations[key].callbacks.forEach(function(fn) {
                if (fn) {
                    fn(fnOut);
                }
            });
            spy._invocations[key].callbacks = [];
            return q(obj);
        }
        else {
            spy._invocations[key].defer = q.defer();
            spy._invocations[key].result = fnOut;
            return spy._invocations[key].defer.promise;
        }
    };
    this._triggerConnect = function() {
        return trigger(that, "connect", "_");
    };
    this._triggerJoinFor = function(channel) {
        return trigger(that, "join", channel);
    };
    this._triggerWhois = function(nick, exists) {
        return trigger(that, "whois", nick, {
            user: (exists ? nick : undefined),
            nick: nick
        });
    };

    // invoke any waiting _findClientAsync calls
    var deferList = deferredsForClients[addr+"_"+nick];
    if (deferList) {
        deferList.forEach(function(defer) {
            defer.resolve(that);
        });
    }
};

module.exports.Client = Client;

// ===== helpers

module.exports._findClientAsync = function(addr, nick) {
    var client = module.exports._findClient(addr, nick);
    if (client) {
        return q(client);
    }
    var key = addr+"_"+nick;
    if (!deferredsForClients[key]) {
        deferredsForClients[key] = [];
    }
    var d = q.defer();
    deferredsForClients[key].push(d);
    return d.promise;
};

module.exports._findClient = function(addr, nick) {
    if (!generatedClients[addr]) {
        return;
    }
    return generatedClients[addr][nick];
};

module.exports._letNickJoinChannel = function(server, nick, channel) {
    return module.exports._findClientAsync(server, nick).then(function(client) {
        return client._triggerConnect();
    }).then(function(client) {
        return client._triggerJoinFor(channel);
    });
};