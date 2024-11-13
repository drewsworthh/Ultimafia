const Game = require("../../core/Game");
const Player = require("./Player");
const Event = require("./Event");
const Queue = require("../../core/Queue");
const Winners = require("./Winners");
const Action = require("./Action");
const stateEventMessages = require("./templates/stateEvents");
const roleData = require("../../../data/roles");
const rolePriority = require("./const/RolePriority");

module.exports = class MafiaGame extends Game {
  constructor(options) {
    super(options);

    this.type = "Mafia";
    this.Player = Player;
    this.states = [
      {
        name: "Postgame",
      },
      {
        name: "Pregame",
      },
      {
        name: "Dusk",
        length: 1000 * 60,
      },
      {
        name: "Night",
        length: options.settings.stateLengths["Night"],
      },
      {
        name: "Dawn",
        length: 1000 * 60,
      },
      {
        name: "Day",
        length: options.settings.stateLengths["Day"],
      },
    ];
    this.pregameWaitLength = options.settings.pregameWaitLength;
    this.extendLength = options.settings.extendLength;
    this.broadcastClosedRoles = options.settings.broadcastClosedRoles;
    this.dayCount = 0;
    this.spectatorMeetFilter = {
      Village: true,
      Pregame: true,
      Postgame: true,
    };
    this.stateEventMessages = stateEventMessages;
    this.noDeathLimit = 6;
    this.statesSinceLastDeath = 0;
    this.resetLastDeath = false;
    this.extensions = 0;
    this.extensionVotes = 0;
    this.hasBeenDay = false;
    this.currentSwapAmt = 1;
    this.RoomOne = [];
    this.RoomTwo = [];
    this.FinalRound = 3;
    this.CurrentRound = 0;
  }

  rebroadcastSetup() {
    if (this.setup.closed && this.broadcastClosedRoles) {
      this.setup.closed = false;
      this.setup.closedRoles = this.setup.roles;
      this.setup.roles = [
        Object.values(this.originalRoles).reduce((acc, e) => {
          if (!acc[e]) {
            acc[e] = 1;
          } else {
            acc[e]++;
          }
          return acc;
        }, {}),
      ];
      this.broadcast("setup", this.setup);
    }
  }

  assignRoles() {
    super.assignRoles();

    this.rebroadcastSetup();

    if (this.setup.votingDead) {
      this.graveyardParticipation = true;
    }

    this.NightOrder = this.getRoleNightOrder();

    for (let playerId in this.originalRoles) {
      let roleName = this.originalRoles[playerId].split(":")[0];
      let data = roleData[this.type][roleName];
      if (data.graveyardParticipation === "all") {
        this.graveyardParticipation = true;
        return;
      }
    }
  }

  async playerLeave(player) {
    await super.playerLeave(player);

    if (this.started && !this.finished) {
      let toRecord =
        player.alive ||
        this.graveyardParticipation ||
        player.requiresGraveyardParticipation();
      if (toRecord) {
        this.recordLeaveStats(player, player.leaveStatsRecorded);
      }

      let action = new Action({
        actor: player,
        target: player,
        priority: -999,
        game: this,
        labels: ["hidden", "absolute", "uncontrollable"],
        run: function () {
          this.target.kill("leave", this.actor, true);
        },
      });

      this.instantAction(action);
    }
  }

  recordLeaveStats(player, statsRecorded) {
    if (!statsRecorded) {
      player.leaveStatsRecorded = true;
      // player.recordStat("survival", false);
      player.recordStat("abandons", true);
    }
  }

  async vegPlayer(player) {
    this.recordLeaveStats(player, false);
    super.vegPlayer(player);
  }

  start() {
    super.start();

    for (let player of this.players) player.recordStat("totalGames");
  }

  incrementState(index, skipped) {
    super.incrementState(index, skipped);

    if (
      (this.setup.startState == "Night" && this.getStateName() == "Night") ||
      (this.setup.startState == "Day" && this.getStateName() == "Day")
    ) {
      this.dayCount++;
    }
    if (this.getStateName() == "Night" && this.PossibleEvents.length > 0) {
      this.selectedEvent = false;
      this.alivePlayers()[0].holdItem("EventManager", 1);
      this.events.emit("ManageRandomEvents");
    }
  }

  getStateInfo(state) {
    var info = super.getStateInfo(state);
    info.dayCount = this.dayCount;

    if (info.name != "Pregame" && info.name != "Postgame") {
      info = {
        ...info,
        name: `${info.name} ${this.dayCount}`,
      };
    }

    return info;
  }

  isMustAct() {
    var mustAct = super.isMustAct();
    mustAct |=
      this.statesSinceLastDeath >= this.noDeathLimit &&
      this.getStateName() != "Sunset";
    return mustAct;
  }

  isMustCondemn() {
    var mustCondemn = super.isMustCondemn();
    mustCondemn |=
      this.statesSinceLastDeath >= this.noDeathLimit &&
      this.getStateName() != "Sunset";
    return mustCondemn;
  }

  inactivityCheck() {
    var stateName = this.getStateName();

    if (!this.resetLastDeath && (stateName == "Day" || stateName == "Night")) {
      this.statesSinceLastDeath++;

      if (this.statesSinceLastDeath >= this.noDeathLimit) {
        if (stateName != "Day")
          this.queueAlert("No one has died for a while, you must act.");
        else
          this.queueAlert(
            "A giant meteor will destroy the town and no one will win if no one dies today."
          );
      }
    } else if (this.resetLastDeath) {
      this.statesSinceLastDeath = 0;
      this.resetLastDeath = false;
      this.meteorImminent = false;
    }
  }

  checkVeg() {
    var prevStateName = this.getStateName();

    if (
      (!this.timers["secondary"] || !this.timers["secondary"].done) &&
      prevStateName == "Day"
    ) {
      for (let meeting of this.meetings) {
        if (meeting.name != "Village") continue;

        for (let member of meeting.members)
          if (
            member.canVote &&
            !meeting.votes[member.id] &&
            !member.player.votedForExtension
          )
            this.extensionVotes++;

        var aliveCount = this.alivePlayers().length;
        var votesNeeded = Math.ceil(aliveCount / 2) + this.extensions;

        if (this.extensionVotes < votesNeeded || this.isTest) break;

        this.timers["main"].extend(this.extendLength * 60 * 1000);
        this.extensions++;
        this.extensionVotes = 0;

        for (let player of this.players) player.votedForExtension = false;

        this.sendAlert("Day extended due to a lack of votes.");
        return;
      }
    }

    this.extensions = 0;
    this.extensionVotes = 0;

    for (let player of this.players) player.votedForExtension = false;

    if (
      this.statesSinceLastDeath >= this.noDeathLimit &&
      prevStateName == "Day"
    )
      this.meteorImminent = true;

    super.checkVeg();
  }

  isNoAct() {
    return (
      this.setup.dawn &&
      this.getStateName() == "Night" &&
      (this.dayCount == 0 ||
        (this.dayCount == 1 && this.setup.startState == "Day"))
    );
  }

  checkGameEnd() {
    var finished = super.checkGameEnd();

    if (finished) return finished;

    if (this.meteorImminent && !this.resetLastDeath) {
      this.queueAlert("A giant meteor obliterates the town!");

      var winners = new Winners(this);
      winners.addGroup("No one");
      this.endGame(winners);

      return true;
    }
  }

  checkWinConditions() {
    var finished = false;
    var counts = {};
    var winQueue = new Queue();
    var winners = new Winners(this);
    var aliveCount = this.alivePlayers().length;

    for (let player of this.players) {
      let alignment = player.role.winCount || player.role.alignment;

      if (!counts[alignment]) counts[alignment] = 0;

      if (player.alive) counts[alignment]++;

      winQueue.enqueue(player.role.winCheck);
    }

    for (let winCheck of winQueue) {
      let stop = winCheck.check(counts, winners, aliveCount, false);
      if (stop) break;
    }

    if (winners.groupAmt() > 0) finished = true;
    else if (aliveCount == 0) {
      winners.addGroup("No one");
      finished = true;
    }

    if (this.isOneNightMode() && this.hasBeenDay == true) {
      finished = true;
    }

    if (
      this.isOneNightMode() == true &&
      this.hasBeenDay == true &&
      winners.groupAmt() <= 0
    ) {
      winners.addGroup("No one");
    }

    if (finished)
      for (let winCheck of winQueue)
        if (winCheck.againOnFinished)
          winCheck.check(counts, winners, aliveCount, true);

    winners.determinePlayers();
    return [finished, winners];
  }

  async endGame(winners) {
    for (let player of this.players) {
      if (player.won) player.recordStat("wins", true);
      else player.recordStat("wins", false);
    }

    await super.endGame(winners);
  }

  getGameTypeOptions() {
    return {
      extendLength: this.extendLength,
      pregameWaitLength: this.pregameWaitLength,
      broadcastClosedRoles: this.broadcastClosedRoles,
    };
  }

  formatRole(role) {
    var roleName = role.split(":")[0];
    var modifiers = role.split(":")[1];
    return `${roleName}${modifiers ? ` (${modifiers})` : ""}`;
  }

  formatRoleInternal(role, modifiers) {
    return `${role}:${modifiers}`;
  }

  getRoleNightOrder() {
    var roleName;
    var nightActions = [];
    var nightActionValue = [];
    var MAFIA_IN_GAME = false;
    for (let x = 0; x < this.PossibleRoles.length; x++) {
      roleName = this.PossibleRoles[x].split(":")[0];
      if (this.getRoleAlignment(roleName) == "Mafia") {
        MAFIA_IN_GAME = true;
      }
      if (rolePriority[this.type][roleName]) {
        for (
          let y = 0;
          y < rolePriority[this.type][roleName].ActionNames.length;
          y++
        ) {
          nightActions.push(
            `${roleName}: ${rolePriority[this.type][roleName].ActionNames[y]}`
          );
          nightActionValue.push(
            rolePriority[this.type][roleName].ActionValues[y]
          );
        }
      }
    }
    if (MAFIA_IN_GAME) {
      nightActions.push(`Mafia: Kill`);
      nightActionValue.push(-1);
    }
    let tempValue;
    let text;
    for (let w = 0; w < nightActionValue.length; w++) {
      for (let r = 0; r < nightActionValue.length; r++) {
        if (nightActionValue[w] < nightActionValue[r]) {
          tempValue = nightActionValue[w];
          text = nightActions[w];
          nightActionValue[w] = nightActionValue[r];
          nightActions[w] = nightActions[r];
          nightActionValue[r] = tempValue;
          nightActions[r] = text;
        }
      }
    }
    //let info = rolePriority[this.type][roleName];
    return nightActions.join(", ");
  }
};
