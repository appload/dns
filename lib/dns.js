(function() {
  var DNS, Response, Zone, dgram, ndns, _;
  var __slice = Array.prototype.slice, __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; };

  dgram = require('dgram');

  ndns = require('./ndns');

  _ = require("underscore");

  Zone = (function() {

    function Zone(domain, options) {
      var record;
      this.domain = this.undotize(domain);
      this.dot_domain = this.dotize(domain);
      this.set_options(options);
      this.records = (function() {
        var _i, _len, _ref, _results;
        _ref = options.records || [];
        _results = [];
        for (_i = 0, _len = _ref.length; _i < _len; _i++) {
          record = _ref[_i];
          _results.push(this.create_record(record));
        }
        return _results;
      }).call(this);
      if (this.select_class("SOA").length === 0) this.add_default_soa();
    }

    Zone.prototype.add_default_soa = function() {
      return this.records.push(this.create_soa());
    };

    Zone.prototype.defaults = function() {
      return {
        ttl: 1200,
        serial: 2011072101,
        refresh: 1800,
        retry: 900,
        expire: 1209600,
        min_ttl: 1200,
        admin: "hostmaster." + this.domain + "."
      };
    };

    Zone.prototype.record_defaults = function() {
      return {
        ttl: this.ttl || this.defaults().ttl,
        "class": "A",
        value: ""
      };
    };

    Zone.prototype.dotize = function(domain) {
      if (domain.slice(-1) === ".") {
        return domain;
      } else {
        return domain + ".";
      }
    };

    Zone.prototype.undotize = function(domain) {
      if (domain.slice(-1) !== ".") {
        return domain;
      } else {
        return domain.slice(0, -1);
      }
    };

    Zone.prototype.set_options = function(options) {
      var defaults, key, val;
      defaults = this.defaults();
      for (key in defaults) {
        val = defaults[key];
        this[key] = options[key] || val;
      }
      return this.admin = this.dotize(this.admin);
    };

    Zone.prototype.create_record = function(record) {
      var r;
      r = _.extend(_.clone(this.record_defaults()), record);
      r.name = r.prefix != null ? this.dotize(r.prefix) + this.dot_domain : this.dot_domain;
      return r;
    };

    Zone.prototype.select_class = function(type) {
      return _(this.records).filter(function(record) {
        return record["class"] === type;
      });
    };

    Zone.prototype.find_class = function(type) {
      return _(this.records).find(function(record) {
        return record["class"] === type;
      });
    };

    Zone.prototype.select = function(type, name) {
      return _(this.records).filter(function(record) {
        return (record["class"] === type) && (record.name === name);
      });
    };

    Zone.prototype.find = function(type, name) {
      return _(this.records).find(function(record) {
        return (record["class"] === type) && (record.name === name);
      });
    };

    Zone.prototype.create_soa = function() {
      var keys, value;
      var _this = this;
      keys = "dot_domain admin serial refresh retry expire min_ttl";
      value = keys.split(" ").map(function(param) {
        return _this[param];
      }).join(" ");
      return {
        name: this.dot_domain,
        ttl: this.ttl,
        "class": "SOA",
        value: value
      };
    };

    Zone.prototype.handles = function(domain) {
      domain = this.dotize(domain);
      if (domain === this.dot_domain) {
        return true;
      } else if (domain.length > this.dot_domain.length) {
        return this.handles(domain.split(".").slice(1).join("."));
      } else {
        return false;
      }
    };

    return Zone;

  })();

  Response = (function() {

    function Response(name, type, zone) {
      this.type = type;
      this.zone = zone;
      this.name = this.zone.dotize(name);
      this.answer = [];
      this.authoritative = [];
      this.additional = [];
    }

    Response.prototype.add = function(obj, to) {
      var o, _i, _len;
      if ((obj != null) && !_(obj).isEmpty()) {
        if (_(obj).isArray()) {
          for (_i = 0, _len = obj.length; _i < _len; _i++) {
            o = obj[_i];
            to.push(o);
          }
        } else {
          to.push(obj);
        }
        return true;
      } else {
        return false;
      }
    };

    Response.prototype.add_answer = function(record) {
      return this.add(record, this.answer);
    };

    Response.prototype.add_authoritative = function(record) {
      return this.add(record, this.authoritative);
    };

    Response.prototype.add_additional = function(record) {
      return this.add(record, this.additional);
    };

    Response.prototype.add_ns_records = function() {
      return this.add_authoritative(this.zone.select_class("NS"));
    };

    Response.prototype.add_additionals = function() {
      var record, _i, _len, _ref, _results;
      _ref = _.union(this.answer, this.authoritative);
      _results = [];
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        record = _ref[_i];
        _results.push(this.add_additional(this.zone.find("A", record.value)));
      }
      return _results;
    };

    Response.prototype.add_soa_to_authoritative = function() {
      return this.add_authoritative(this.zone.find_class("SOA"));
    };

    Response.prototype.resolve = function() {
      if (this.add_answer(this.zone.select("CNAME", this.name))) {} else if (this.type === "NS" && this.add_answer(this.zone.select(this.type, this.name))) {} else if (this.add_answer(this.zone.select(this.type, this.name))) {
        this.add_ns_records();
      } else {
        this.add_soa_to_authoritative();
      }
      this.add_additionals();
      return this;
    };

    Response.prototype.commit = function(req, res) {
      var ancount, arcount, key, nscount, record, val, value, _i, _len, _ref, _ref2;
      ancount = this.answer.length;
      nscount = this.authoritative.length;
      arcount = this.additional.length;
      _ref = {
        qr: 1,
        ra: 0,
        rd: 1,
        aa: 1,
        ancount: ancount,
        nscount: nscount,
        arcount: arcount
      };
      for (key in _ref) {
        val = _ref[key];
        res.header[key] = val;
      }
      _ref2 = _.union(this.answer, this.authoritative, this.additional);
      for (_i = 0, _len = _ref2.length; _i < _len; _i++) {
        record = _ref2[_i];
        value = _(record.value).isArray() ? record.value : record.value.split(" ");
        res.addRR.apply(res, [record.name, record.ttl, "IN", record["class"]].concat(__slice.call(value)));
      }
      return this;
    };

    return Response;

  })();

  DNS = (function() {

    function DNS(zones) {
      this.resolve = __bind(this.resolve, this);      this.server = ndns.createServer('udp4');
      this.server.on('request', this.resolve);
      this.port || (this.port = 53);
      this.reload(zones || {});
    }

    DNS.prototype.reload = function(zones) {
      var key, val;
      return this.zones = (function() {
        var _results;
        _results = [];
        for (key in zones) {
          val = zones[key];
          _results.push(new Zone(key, val));
        }
        return _results;
      })();
    };

    DNS.prototype.listen = function(port) {
      return this.server.bind(port || this.port);
    };

    DNS.prototype.resolve = function(req, res) {
      var name, q, response, type, zone, _i, _len, _ref;
      res.setHeader(req.header);
      _ref = req.q;
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        q = _ref[_i];
        res.addQuestion(q);
      }
      if (req.q.length > 0) {
        name = req.q[0].name;
        type = req.q[0].typeName;
        if (zone = _.find(this.zones, (function(zone) {
          return zone.handles(name);
        }))) {
          console.log("zone found", zone.dot_domain);
          response = new Response(name, type, zone);
          response.resolve().commit(req, res);
        }
      }
      return res.send();
    };

    DNS.prototype.close = function() {
      return this.server.close();
    };

    return DNS;

  })();

  exports.createServer = function() {
    var config;
    config = 1 <= arguments.length ? __slice.call(arguments, 0) : [];
    return (function(func, args, ctor) {
      ctor.prototype = func.prototype;
      var child = new ctor, result = func.apply(child, args);
      return typeof result === "object" ? result : child;
    })(DNS, config, function() {});
  };

}).call(this);
