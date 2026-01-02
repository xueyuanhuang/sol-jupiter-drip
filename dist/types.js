"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CycleState = void 0;
var CycleState;
(function (CycleState) {
    CycleState["INIT"] = "INIT";
    CycleState["BOUGHT"] = "BOUGHT";
    CycleState["SOLD"] = "SOLD"; // Sold token, cycle complete (transient state before next INIT?)
})(CycleState || (exports.CycleState = CycleState = {}));
