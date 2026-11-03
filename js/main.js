'use strict';

/* ============================== start ============================== */
// Loaded last: everything above is defined by now.
if (typeof window !== 'undefined') window.RI = { db: () => db, ui, api, store, mem, plan, units, qfx, gen, dict, info, modes, runner, clock, parseInput, record, FSRS_W };
if (typeof document !== 'undefined') ui.init();
