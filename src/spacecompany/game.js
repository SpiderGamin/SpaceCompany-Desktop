const { BrowserWindow } = require("electron");
const path = require("path");
const vex = require("vex-js");
vex.registerPlugin(require("vex-dialog"));
vex.defaultOptions.className = "vex-theme-os";

var fullscreen = false;

var Game = (function () {
	"use strict";

	var instance = {
		ui: {},
		lastUpdateTime: 0,
		intervals: {},
		uiComponents: [],
		logoAnimating: true,
		timeSinceAutoSave: 0,
		activeNotifications: {},
		lastFixedUpdate: new Date().getTime(),
	};

	instance.update_frame = function (time) {
		Game.update(time - Game.lastUpdateTime);
		Game.lastUpdateTime = time;

		// This ensures that we wait for the browser to "catch up" to drawing and other events
		window.requestAnimationFrame(Game.update_frame);
	};

	instance.update = function (delta) {
		for (var name in this.intervals) {
			var data = this.intervals[name];
			data.e += delta;
			if (data.e > data.d) {
				data.c(this, data.e / 1000);
				data.e = 0;
			}
		}
	};

	instance.createInterval = function (name, callback, delay) {
		this.intervals[name] = { c: callback, d: delay, e: 0 };
	};

	instance.deleteInterval = function (name) {
		delete this.intervals[name];
	};

	instance.fixedUpdate = function () {
		var currentTime = new Date().getTime();
		var delta = (currentTime - this.lastFixedUpdate) / 1000;
		this.lastFixedUpdate = currentTime;

		refreshPerSec(delta);
		gainResources(delta);
		fixStorageRounding();
	};

	instance.fastUpdate = function (self, delta) {
		refreshWonderBars();
		checkRedCost();

		updateResourceEfficiencyDisplay();
		updateEnergyEfficiencyDisplay();
		updateScienceEfficiencyDisplay();
		updateBatteryEfficiencyDisplay();

		legacyRefreshUI();

		self.ui.updateBoundElements(delta);

		self.resources.update(delta);
		self.buildings.update(delta);
		self.tech.update(delta);
		self.settings.update(delta);

		self.updateAutoSave(delta);

		if (delta > 1) {
			console.log(
				"You have been away for " + Game.utils.getTimeDisplay(delta)
			);
		}
	};

	instance.slowUpdate = function (self, delta) {
		refreshConversionDisplay();
		refreshTimeUntilLimit();
		gainAutoEmc();

		checkStorages();

		self.updateTime(delta);

		self.achievements.update(delta);
		self.statistics.update(delta);
	};

	instance.uiUpdate = function (self, delta) {
		for (var i = 0; i < self.uiComponents.length; i++) {
			self.uiComponents[i].update(delta);
		}
	};

	instance.updateTime = function (delta) {
		Game.statistics.add("sessionTime", delta);
		Game.statistics.add("timePlayed", delta);
	};

	instance.import = function () {
		var text = $("#impexpField").val();
		if (!text.trim()) return console.warn("No save to import provided.");
		if (text.length % 4 !== 0) {
			console.log(
				"String is not valid base64 encoded: " +
					text.length +
					" (" +
					(text.length % 4) +
					")"
			);
			return;
		}

		var decompressed = LZString.decompressFromBase64(text);
		if (!decompressed) {
			console.log("Import Game failed, could not decompress!");
			return;
		}
		/*
        storage.set("spacecompany.json", decompressed, (err) => {
            if (err) {
                console.error(err)
            }
        });
        */
		localStorage.setItem("save", decompressed);

		console.log("Imported Saved Game");

		window.location.reload();
	};

	instance.export = function () {
		var data = this.save();

		var string = JSON.stringify(data);
		var compressed = LZString.compressToBase64(string);

		console.log("Compressing Save");
		console.log(
			"Compressed from " +
				string.length +
				" to " +
				compressed.length +
				" characters"
		);
		$("#impexpField").val(compressed);
	};

	instance.save = function () {
		var data = {
			lastFixedUpdate: this.lastFixedUpdate,
		};

		this.achievements.save(data);
		this.statistics.save(data);
		this.resources.save(data);
		this.buildings.save(data);
		this.tech.save(data);
		this.settings.save(data);
		this.interstellar.save(data);
		this.stargaze.save(data);
		this.updates.save(data);

		data = legacySave(data);

		/*storage.set("spacecompany.json", data, (err) => {
            if (err) {
                console.error(err)
            }
        });*/
		localStorage.setItem("save", JSON.stringify(data));
		Game.notifyInfo(
			"Game Saved",
			"Your save data has been stored in localStorage on your computer"
		);
		console.log("Game Saved");

		return data;
	};

	instance.load = function () {
		/*var data;
        storage.get("spacecompany.json", (err, savedata) => {
            if (err) {
                console.error(err)
            } else {
                data = savedata;
                console.log(`Data: ${data}\n\nSavedata ${savedata}`)
            }
        });*/
		console.log("Save loaded");

		var data = JSON.parse(localStorage.getItem("save"));

		if (data && data !== null) {
			this.achievements.load(data);
			this.statistics.load(data);
			this.resources.load(data);
			this.buildings.load(data);
			this.stargaze.load(data);
			this.tech.load(data);
			this.interstellar.load(data);
			this.updates.load(data);

			legacyLoad(data);

			this.settings.load(data);

			if (
				data != null &&
				data.lastFixedUpdate &&
				!isNaN(data.lastFixedUpdate)
			) {
				this.handleOfflineGains(
					(new Date().getTime() - data.lastFixedUpdate) / 1000
				);
			}
		}

		console.log("Load Successful");
	};

	instance.updateUI = function (self) {
		Game.settings.updateCompanyName();
		refreshResources();
		refreshResearches();
		refreshTabs();

		updateCost();
		updateDysonCost();
		updateFuelProductionCost();
		updateLabCost();
		updateWonderCost();

		if (Game.constants.enableMachineTab === true) {
			$("#machineTopTab").show();
		}

		$("#versionLabel").text(versionNumber);
		$("#desktopversion").text(desktopVersion);

		self.interstellar.redundantChecking();
	};

	instance.handleOfflineGains = function (offlineTime) {
		if (offlineTime <= 0) {
			return;
		}

		refreshPerSec(1);
		gainResources(offlineTime);
		fixStorageRounding();

		this.notifyOffline(offlineTime);
	};

	instance.deleteSave = function () {
		var deleteSave;
		vex.dialog.prompt({
			message:
				"Are you sure you want to delete this save? It is irreversible! If so, type 'DELETE' into the box.",
			placeholder: "DELETE",
			callback: function (value) {
				deleteSave = value;
				console.log(value);
				if (deleteSave === "DELETE") {
					localStorage.removeItem("save");

					vex.dialog.alert("Deleted Save");
					window.location.reload();
				} else {
					vex.dialog.alert("Deletion Cancelled");
				}
			},
		});
	};

	instance.loadDelay = function (self, delta) {
		// document.getElementById("game").className = "container bar-seperate";

		self.deleteInterval("Loading");

		registerLegacyBindings();
		self.ui.updateAutoDataBindings();

		// Initialize first
		self.achievements.initialise();
		self.statistics.initialise();
		self.resources.initialise();
		self.buildings.initialise();
		self.tech.initialise();
		self.interstellar.initialise();
		self.stargaze.initialise();

		// Now load
		self.load();

		self.settings.initialise();

		for (var i = 0; i < self.uiComponents.length; i++) {
			self.uiComponents[i].initialise();
		}

		self.updateUI(self);

		// Display what has changed since last time
		self.updates.initialise();

		// Then start the main loops
		self.createInterval("Fast Update", self.fastUpdate, 100);
		self.createInterval("Slow Update", self.slowUpdate, 1000);
		self.createInterval("UI Update", self.uiUpdate, 100);

		// Do this in a setInterval so it gets called even when the window is inactive
		window.setInterval(function () {
			Game.fixedUpdate();
		}, 100);

		setTimeout(function () {
			document.getElementById("loadScreen").className = "hidden";
			document.getElementById("mainPage").className = "page-content";
		}, 150);
		console.debug("Load Complete");
	};

	instance.loadAnimation = function (self, delta) {
		if (self.logoAnimating === false) {
			return;
		}

		var logoElement = $("#loadLogo");
		var opacity = logoElement.css("opacity");
		if (opacity >= 0.9) {
			logoElement.fadeTo(1000, 0.95, function () {
				Game.logoAnimating = false;
			});
			self.logoAnimating = true;
		} else if (opacity <= 0.3) {
			logoElement.fadeTo(1000, 0.95, function () {
				Game.logoAnimating = false;
			});
			self.logoAnimating = true;
		}
	};

	instance.noticeStack = {
		dir1: "up",
		dir2: "left",
		firstpos1: 25,
		firstpos2: 25,
	};

	instance.notifyInfo = function (title, message) {
		if (
			title == "Game Saved" &&
			Game.settings.entries.saveNotifsEnabled == false
		) {
			return;
		}
		if (Game.settings.entries.notificationsEnabled === true) {
			this.activeNotifications.info = new PNotify({
				title: title,
				text: message,
				type: "info",
				animation: "fade",
				animate_speed: "fast",
				addclass: "stack-bottomright",
				stack: this.noticeStack,
			});
		}
	};

	instance.notifySuccess = function (title, message) {
		if (Game.settings.entries.notificationsEnabled === true) {
			this.activeNotifications.success = new PNotify({
				title: title,
				text: message,
				type: "success",
				animation: "fade",
				animate_speed: "fast",
				addclass: "stack-bottomright",
				stack: this.noticeStack,
			});
		}
	};

	instance.notifyStorage = function () {
		if (Game.settings.entries.notificationsEnabled === true) {
			this.activeNotifications.storage = new PNotify({
				title: "Storage Full!",
				text:
					"You will no longer collect resources when they are full.",
				type: "warning",
				animation: "fade",
				animate_speed: "fast",
				addclass: "stack-bottomright",
				stack: this.noticeStack,
			});

			this.activeNotifications.storage.get().click(function () {
				Game.activeNotifications.storage.remove();
				Game.activeNotifications.storage = undefined;
			});
		}
	};

	instance.notifyOffline = function (time) {
		this.activeNotifications.success = new PNotify({
			title: "Offline Gains",
			text:
				"You've been offline for " +
				Game.utils.getFullTimeDisplay(time, true),
			type: "info",
			animation: "fade",
			animate_speed: "fast",
			addclass: "stack-bottomright",
			stack: this.noticeStack,
		});
	};

	instance.removeExcess = function (array, id) {
		var check = false;
		for (var i = array.length; i > 0; i--) {
			if (array[i] === id) {
				if (check === false) {
					check = true;
				} else {
					check = true;
					array.splice(i, 1);
				}
			}
		}
	};

	instance.updateAutoSave = function (delta) {
		this.timeSinceAutoSave += delta;

		var element = $("#autoSaveTimer");
		var timeSinceSaveInMS = this.timeSinceAutoSave * 1000;
		var timeLeft =
			Game.settings.entries.autoSaveInterval - timeSinceSaveInMS;

		if (timeLeft <= 15000) {
			element.show();
			if (timeLeft <= 5000) {
				element.text(
					"Autosaving in " + (timeLeft / 1000).toFixed(1) + " seconds"
				);
				document.getElementsByClassName("menu-title")[0].innerHTML =
					companyName +
					" Company - Autosaving in " +
					(timeLeft / 1000).toFixed(1) +
					" seconds";
				// document.title = companyName + " Company - Autosaving in " + (timeLeft / 1000).toFixed(1) + " seconds";
			} else {
				element.text(
					"Autosaving in " + (timeLeft / 1000).toFixed(0) + " seconds"
				);
				document.getElementsByClassName("menu-title")[0].innerHTML =
					companyName +
					" Company - Autosaving in " +
					(timeLeft / 1000).toFixed(0) +
					" seconds";
				// document.title = companyName + " Company - Autosaving in " + (timeLeft / 1000).toFixed(0) + " seconds";
			}
		} else {
			element.hide();
			document.getElementsByClassName("menu-title")[0].innerHTML =
				companyName + " Company";
			// document.title = companyName + " Company";
		}

		if (timeLeft < 100) {
			document.getElementsByClassName("menu-title")[0].innerHTML =
				companyName + " Company";
			// document.title = companyName + " Company";
			this.save();
			this.timeSinceAutoSave = 1;
		}
	};

	instance.start = function () {
		PNotify.prototype.options.styling = "bootstrap3";
		PNotify.prototype.options.delay = 3500;

		$('[data-toggle="tooltip"]').tooltip();

		console.debug("Loading Game");

		this.createInterval("Loading Animation", this.loadAnimation, 10);
		this.createInterval("Loading", this.loadDelay, 1000);

		this.update_frame(0);
	};

	instance.loadFromData = function () {
		vex.dialog.prompt({
			message: "Paste your save data",
			placeholder: "Data Goes Here",
			callback: function (value) {
				var text = value;
				if (text) {
					if (!text.trim())
						return console.warn("No save to import provided.");
					if (text.length % 4 !== 0) {
						console.log(
							"String is not valid base64 encoded: " +
								text.length +
								" (" +
								(text.length % 4) +
								")"
						);
						return;
					}

					var decompressed = LZString.decompressFromBase64(text);
					if (!decompressed) {
						console.log(
							"Import Game failed, could not decompress!"
						);
						return;
					}
					localStorage.setItem("save", decompressed);

					console.log("Imported Saved Game");

					window.location.reload();
				} else {
					return;
				}
			},
		});
	};

	instance.mainMenu = function (event, data) {
		switch (event) {
			case "play": {
				document.getElementById("game").className =
					"container bar-seperate";
				return (document.getElementById("mainPage").className =
					"hidden");
			}
			case "settings": {
				return (document.getElementById("settingsPage").className =
					"show page-content");
			}
			case "stats": {
				return (document.getElementById("statsPage").className =
					"show page-content");
			}
			case "help": {
				return (document.getElementById("helpPage").className =
					"show page-content");
			}
			case "credits": {
				return (document.getElementById("creditsPage").className =
					"show page-content");
			}
			case "back": {
				document.getElementById("settingsPage").className = "hidden";
				document.getElementById("statsPage").className = "hidden";
				document.getElementById("helpPage").className = "hidden";
				document.getElementById("creditsPage").className = "hidden";
				return;
			}
			case "main": {
				return (document.getElementById("mainPage").className =
					"page-content");
			}
			case "fullscreen": {
				if (fullscreen ? (fullscreen = false) : (fullscreen = true));
				console.log(fullscreen);
				return app.BrowserWindow.getFocusedWindow().setFullScreen(
					fullscreen
				);
			}
			case "reload": {
				this.save();
				return location.reload();
			}
			case "devTools": {
				return app.BrowserWindow.getFocusedWindow().webContents.openDevTools();
			}
			case "quit": {
				if (data !== "save") {
					return;
					// return BrowserWindow.getFocusedWindow().close();
					// return app.BrowserWindow.getFocusedWindow().close();
				} else {
					this.save();
					return;// BrowserWindow.getFocusedWindow().close();
				}
			}
		}
	};

	return instance;
})();

window.onload = function () {
	Game.start();
};
