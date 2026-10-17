"""Read a password from stdin and print its bcrypt hash (cost 12). Used by setup.sh."""

import sys

import bcrypt

password = sys.stdin.read().encode()
if not password:
    sys.exit("hash-password: empty password on stdin")
print(bcrypt.hashpw(password, bcrypt.gensalt(rounds=12)).decode())
