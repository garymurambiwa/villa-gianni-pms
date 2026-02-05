import { Room } from "@/types";

export const DEFAULT_ROOMS: Room[] = [
    // Standard Room – 80
    { id: "R_101", number: "101", type: "Standard Room", status: "VC", floor: 1, rate: 80 },
    { id: "R_103", number: "103", type: "Standard Room", status: "VC", floor: 1, rate: 80 },
    { id: "R_105", number: "105", type: "Standard Room", status: "VC", floor: 1, rate: 80 },
    { id: "R_107", number: "107", type: "Standard Room", status: "VC", floor: 1, rate: 80 },
    { id: "R_108", number: "108", type: "Standard Room", status: "VC", floor: 1, rate: 80 },

    // Executive Room – 100
    { id: "R_109", number: "109", type: "Executive Room", status: "VC", floor: 1, rate: 100 },
    { id: "R_106", number: "106", type: "Executive Room", status: "VC", floor: 1, rate: 100 },
    { id: "R_110", number: "110", type: "Executive Room", status: "VC", floor: 1, rate: 100 },
    { id: "R_112", number: "112", type: "Executive Room", status: "VC", floor: 1, rate: 100 },

    // Executive Suite – 150
    { id: "R_113", number: "113", type: "Executive Suite", status: "VC", floor: 1, rate: 150 },
    { id: "R_104", number: "104", type: "Executive Suite", status: "VC", floor: 1, rate: 150 },

    // Villa Self Catering – 300
    { id: "R_114", number: "114", type: "Villa Self Catering", status: "VC", floor: 1, rate: 300 },
    { id: "R_115", number: "115", type: "Villa Self Catering", status: "VC", floor: 1, rate: 300 },

    // New Lodge – 300
    { id: "R_116", number: "116", type: "New Lodge", status: "VC", floor: 1, rate: 300 },
];
