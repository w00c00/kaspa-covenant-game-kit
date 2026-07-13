# Third-Party Notices

This package vendors small JavaScript helper files derived from Kascov for
SilverScript escrow program emission and BLAKE2b hashing:

- `vendor/kascov-blake2b.js`
- `vendor/kascov-disasm.js`

Kascov project:

- Repository: https://github.com/Knitser/kascov
- License: MIT
- Copyright (c) 2026 Michiel Hamblok

The vendored files are included so SDK users can build the same Escrow program
without depending on a browser bundle from the original Kaspa Arena prototype.

`contracts/escrow.sil` is copied from the official SilverScript repository at
commit `956868ea63a2af4176889f1331449b5f4f9e1df8`:

- Repository: https://github.com/kaspanet/silverscript
- License: ISC
- Copyright 2026 Kaspa Developers
