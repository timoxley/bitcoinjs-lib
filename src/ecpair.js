var assert = require('assert')
var base58check = require('bs58check')
var bcrypto = require('./crypto')
var crypto = require('crypto')
var ecdsa = require('./ecdsa')
var enforceType = require('./types')
var networks = require('./networks')

var Address = require('./address')
var BigInteger = require('bigi')

var ecurve = require('ecurve')
var curve = ecurve.getCurveByName('secp256k1')

function findNetworkByWIFVersion(version) {
  for (var networkName in networks) {
    var network = networks[networkName]

    if (network.wif === version) return network
  }

  assert(false, 'Unknown network')
}

function ECPair(d, Q, options) {
  options = options || {}

  if (options.compressed === undefined) options.compressed = true
  if (options.network === undefined) options.network = networks.bitcoin

  enforceType('Boolean', options.compressed)

  if (d) {
    assert(d.signum() > 0, 'Private key must be greater than 0')
    assert(d.compareTo(curve.n) < 0, 'Private key must be less than the curve order')
  }

  if (Q) {
    enforceType(ecurve.Point, Q)

  } else {
    Q = curve.G.multiply(d)
  }

  this.compressed = options.compressed
  this.d = d
  this.Q = Q
  this.network = options.network
}

// Public access to secp256k1 curve
ECPair.curve = curve

// Static constructors
ECPair.fromPublicKey = function(buffer, network) {
  var Q = ecurve.Point.decodeFrom(curve, buffer)

  return new ECPair(null, Q, {
    compressed: Q.compressed,
    network: network
  })
}

ECPair.fromWIF = function(string) {
  var payload = base58check.decode(string)
  var version = payload.readUInt8(0)
  var compressed

  if (payload.length === 34) {
    assert.strictEqual(payload[33], 0x01, 'Invalid compression flag')

    // Truncate the version/compression bytes
    payload = payload.slice(1, -1)
    compressed = true

  } else {
    assert.equal(payload.length, 33, 'Invalid WIF payload length')

    // Truncate the version byte
    payload = payload.slice(1)
    compressed = false
  }

  var network = findNetworkByWIFVersion(version)
  var d = BigInteger.fromBuffer(payload)

  return new ECPair(d, null, {
    compressed: compressed,
    network: network
  })
}

ECPair.makeRandom = function(options, rng) {
  rng = rng || crypto.randomBytes

  var buffer = rng(32)
  enforceType('Buffer', buffer)
  assert.equal(buffer.length, 32, 'Expected 256-bit Buffer from RNG')

  var d = BigInteger.fromBuffer(buffer)
  d = d.mod(curve.n)

  return new ECPair(d, null, options)
}

// Export functions
ECPair.prototype.toWIF = function() {
  assert(this.d, 'Missing private key')

  var bufferLen = this.compressed ? 34 : 33
  var buffer = new Buffer(bufferLen)

  buffer.writeUInt8(this.network.wif, 0)
  this.d.toBuffer(32).copy(buffer, 1)

  if (this.compressed) {
    buffer.writeUInt8(0x01, 33)
  }

  return base58check.encode(buffer)
}

ECPair.prototype.getAddress = function() {
  var pubKey = this.getPublicKey()

  return new Address(bcrypto.hash160(pubKey), this.network.pubKeyHash)
}

ECPair.prototype.getPublicKey = function() {
  return this.Q.getEncoded(this.compressed)
}

// ECC Operations
ECPair.prototype.sign = function(hash) {
  assert(this.d, 'Missing private key')

  return ecdsa.sign(curve, hash, this.d)
}

ECPair.prototype.verify = function(hash, signature) {
  return ecdsa.verify(curve, hash, signature, this.Q)
}

module.exports = ECPair