const Role = require("../../Role");

module.exports = class Coroner extends Role {
  constructor(player, data) {
    super("Coroner", player, data);
    this.alignment = "Village";
    this.cards = ["VillageCore", "WinWithFaction", "MeetingFaction", "LearnRole"];
    this.meetingMods = {
      "Learn Role": {
        targets: { include: ["dead"], exclude: ["alive", "self"] },
      },
    };
  }
};
