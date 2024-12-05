const Event = require("../Event");
const Action = require("../Action");
const Random = require("../../../../lib/Random");
const {
  PRIORITY_ITEM_GIVER_DEFAULT,
  PRIORITY_INVESTIGATIVE_AFTER_RESOLVE_DEFAULT,
} = require("../const/Priority");

module.exports = class SensibleMood extends Event {
  constructor(modifiers, game) {
    super("Sensible Mood", modifiers, game);
  }

  getNormalRequirements() {
    return true;
  }

  doEvent() {
    super.doEvent();
    let victim = Random.randArrayVal(this.game.alivePlayers());
    this.action = new Action({
      actor: victim,
      target: victim,
      game: this.game,
      priority: PRIORITY_INVESTIGATIVE_AFTER_RESOLVE_DEFAULT,
      labels: ["hidden", "absolute"],
      run: function () {
        if (this.game.SilentEvents != false) {
          this.game.queueAlert(
            `Event: Sensible Mood! 1-3 Players will Learn if their role has changed!`
          );
        }
        let players = this.game.alivePlayers();
        players = Random.randomizeArray(players);
        let count = Random.randInt(1, 3);
        if (players.length < count) {
          count = players.length;
        }
        for (let x = 0; x < count; x++) {
          players[x].queueAlert(`Your role is ${players[x].role.name}`);
        }
      },
    });
    this.game.queueAction(this.action);
  }
};