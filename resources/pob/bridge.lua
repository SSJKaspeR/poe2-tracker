-- PoE2 Tracker — headless Path of Building bridge
--
-- Runs the unmodified Path of Building (PoE 2) engine without a UI and answers
-- newline-delimited JSON requests on stdin. Every response is one line on stdout
-- prefixed with RESPONSE_PREFIX; anything PoB prints is redirected to stderr.
--
-- Must be started with the PoB `src/` directory as the working directory, and
-- with LUA_PATH including PoB's `runtime/lua/` folder.
--
-- Request:  {"id": 1, "cmd": "stats"}
-- Response: @@POB@@{"id": 1, "ok": true, "result": {...}}

local RESPONSE_PREFIX = "@@POB@@"

local realStdout = io.stdout
local function log(...)
	local parts = {}
	for i = 1, select("#", ...) do
		parts[#parts + 1] = tostring((select(i, ...)))
	end
	io.stderr:write(table.concat(parts, "\t"), "\n")
end

-- PoB prints a lot during startup; keep stdout clean for the protocol.
print = log

-- HeadlessWrapper ends with io.read on startup errors; make that non-blocking.
local realRead = io.read
io.read = function(...)
	return nil
end

dofile("HeadlessWrapper.lua")

io.read = realRead

---------------------------------------------------------------------------
-- zlib via FFI (the headless SimpleGraphic stubs return empty strings)
---------------------------------------------------------------------------
local ffi = require("ffi")
ffi.cdef([[
typedef unsigned long uLongf;
int compress2(unsigned char *dest, uLongf *destLen, const unsigned char *source, unsigned long sourceLen, int level);
int uncompress(unsigned char *dest, uLongf *destLen, const unsigned char *source, unsigned long sourceLen);
unsigned long compressBound(unsigned long sourceLen);
]])

local zlib
do
	local candidates = ffi.os == "Windows" and { "zlib1", "z", "zlib" } or { "z", "libz.so.1" }
	for _, name in ipairs(candidates) do
		local ok, lib = pcall(ffi.load, name)
		if ok then
			zlib = lib
			break
		end
	end
end

function Deflate(data)
	if not zlib then return nil, "zlib not available" end
	local bound = zlib.compressBound(#data)
	local buf = ffi.new("unsigned char[?]", bound)
	local len = ffi.new("uLongf[1]", bound)
	local rc = zlib.compress2(buf, len, data, #data, 9)
	if rc ~= 0 then return nil, "compress2 failed: " .. rc end
	return ffi.string(buf, len[0])
end

function Inflate(data)
	if not zlib then return nil, "zlib not available" end
	local size = math.max(#data * 8, 65536)
	for _ = 1, 8 do
		local buf = ffi.new("unsigned char[?]", size)
		local len = ffi.new("uLongf[1]", size)
		local rc = zlib.uncompress(buf, len, data, #data)
		if rc == 0 then
			return ffi.string(buf, len[0])
		elseif rc == -5 then -- Z_BUF_ERROR: output buffer too small
			size = size * 4
		else
			return nil, "uncompress failed: " .. rc
		end
	end
	return nil, "uncompress: output too large"
end

local json = require("dkjson")

---------------------------------------------------------------------------
-- Helpers
---------------------------------------------------------------------------

-- Player stats exposed to the app. Missing values are omitted.
local STAT_KEYS = {
	-- Offence
	"TotalDPS", "CombinedDPS", "TotalDotDPS", "AverageHit", "Speed", "CritChance", "CritMultiplier", "HitChance",
	"AreaOfEffectRadiusMetres",
	-- Defence
	"Life", "LifeUnreserved", "EnergyShield", "Mana", "ManaUnreserved", "Spirit", "SpiritUnreserved",
	"Armour", "Evasion", "Ward", "TotalEHP",
	"FireResist", "ColdResist", "LightningResist", "ChaosResist",
	"FireResistOverCap", "ColdResistOverCap", "LightningResistOverCap", "ChaosResistOverCap",
	"EffectiveBlockChance", "EffectiveSpellBlockChance",
	"PhysicalMaximumHitTaken", "FireMaximumHitTaken", "ColdMaximumHitTaken", "LightningMaximumHitTaken",
	"ChaosMaximumHitTaken",
	-- Sustain / utility
	"LifeRegenRecovery", "LifeLeechGainRate", "EnergyShieldRegenRecovery", "ManaRegenRecovery",
	"EffectiveMovementSpeedMod",
	-- Attributes
	"Str", "Dex", "Int",
}

local function pickStats(output)
	local out = {}
	if not output then return out end
	for _, key in ipairs(STAT_KEYS) do
		local v = output[key]
		if type(v) == "number" and v == v and v ~= math.huge and v ~= -math.huge then
			out[key] = v
		end
	end
	return out
end

local function requireBuild()
	if not build or not build.calcsTab or not build.calcsTab.mainOutput then
		error("no build loaded")
	end
end

local function buildInfo()
	local info = {
		className = build.spec and build.spec.curClassName or nil,
		ascendancy = build.spec and build.spec.curAscendClassName or nil,
		level = build.characterLevel,
		mainSkill = nil,
	}
	local env = build.calcsTab.mainEnv
	if env and env.player and env.player.mainSkill and env.player.mainSkill.activeEffect then
		local grant = env.player.mainSkill.activeEffect.grantedEffect
		info.mainSkill = grant and grant.name or nil
	end
	return info
end

local function equippedItems()
	local items = {}
	for _, slot in ipairs(build.itemsTab.orderedSlots) do
		if not slot.inactive and slot.selItemId and slot.selItemId ~= 0 then
			local item = build.itemsTab.items[slot.selItemId]
			if item then
				items[#items + 1] = {
					slot = slot.slotName,
					name = item.name,
					rarity = item.rarity,
					base = item.baseName,
				}
			end
		end
	end
	return items
end

local function decodeBuildCode(code)
	code = code:gsub("%s", "")
	local raw = common.base64.decode((code:gsub("-", "+"):gsub("_", "/")))
	if not raw or #raw == 0 then error("invalid build code (base64)") end
	local xml, err = Inflate(raw)
	if not xml or #xml == 0 then error("invalid build code (zlib): " .. tostring(err)) end
	return xml
end

local function encodeBuildCode(xml)
	local compressed, err = Deflate(xml)
	if not compressed then error(err) end
	return (common.base64.encode(compressed):gsub("+", "-"):gsub("/", "_"))
end

local function diff(base, new)
	local d = {}
	for key, after in pairs(new) do
		local before = base[key]
		if before ~= nil and math.abs(after - before) > 1e-9 then
			d[key] = { before = before, after = after, delta = after - before }
		end
	end
	return d
end

local function resultFor(output)
	return { stats = pickStats(output) }
end

---------------------------------------------------------------------------
-- Commands
---------------------------------------------------------------------------
local commands = {}

function commands.ping()
	return { pong = true, version = launch and launch.versionNumber or nil }
end

function commands.new_build()
	newBuild()
	return { info = buildInfo(), stats = pickStats(build.calcsTab.mainOutput) }
end

function commands.load_xml(req)
	assert(type(req.xml) == "string", "xml required")
	loadBuildFromXML(req.xml, req.name or "Imported")
	requireBuild()
	return { info = buildInfo(), stats = pickStats(build.calcsTab.mainOutput), items = equippedItems() }
end

function commands.load_code(req)
	assert(type(req.code) == "string", "code required")
	local xml = decodeBuildCode(req.code)
	return commands.load_xml({ xml = xml, name = req.name })
end

function commands.export_code()
	requireBuild()
	local xml = build:SaveDB("code")
	return { code = encodeBuildCode(xml) }
end

function commands.export_xml()
	requireBuild()
	return { xml = build:SaveDB("code") }
end

function commands.stats()
	requireBuild()
	return { info = buildInfo(), stats = pickStats(build.calcsTab.mainOutput), items = equippedItems() }
end

-- Compare an item (raw text as copied with Ctrl+C in game) against the
-- currently equipped item in the same slot.
function commands.compare_item(req)
	requireBuild()
	assert(type(req.itemText) == "string", "itemText required")
	local item = new("Item"):Item(req.itemText)
	if not item.base then error("unrecognised item") end
	item:NormaliseQuality()
	item:BuildModList()
	local slotName = req.slot or item:GetPrimarySlot()
	local calcFunc, baseOutput = build.calcsTab:GetMiscCalculator()
	local newOutput = calcFunc({ repSlotName = slotName, repItem = item })
	local before = pickStats(baseOutput)
	local after = pickStats(newOutput)
	return {
		slot = slotName,
		item = { name = item.name, rarity = item.rarity, base = item.baseName },
		before = before,
		after = after,
		diff = diff(before, after),
	}
end

-- Equip an item (raw text) in its slot, replacing what is there, and recalculate.
function commands.equip_item(req)
	requireBuild()
	assert(type(req.itemText) == "string", "itemText required")
	local item = new("Item"):Item(req.itemText)
	if not item.base then error("unrecognised item") end
	-- No NormaliseQuality here: the equipped item keeps its real quality.
	if not item.quality then item.quality = 0 end
	local slotName = req.slot or item:GetPrimarySlot()
	local slot = build.itemsTab.slots[slotName]
	if not slot then error("unknown slot " .. tostring(slotName)) end
	build.itemsTab:AddItem(item, true)
	slot:SetSelItemId(item.id)
	build.itemsTab:PopulateSlots()
	build.buildFlag = true
	runCallback("OnFrame")
	return { slot = slotName, info = buildInfo(), stats = pickStats(build.calcsTab.mainOutput), items = equippedItems() }
end

-- Best ordinary base of the same type/subType the character can wear.
local function bestBaseFor(item, charLevel)
	if not item.base or not data.itemBases then return nil end
	local best, bestName
	for name, base in pairs(data.itemBases) do
		local tags = base.tags or {}
		if base.type == item.base.type and base.subType == item.base.subType
			and not base.hidden and not tags.not_for_sale and not tags.runeforged then
			local req = base.req and base.req.level or 0
			if req <= charLevel and (not best or req > (best.req and best.req.level or 0)) then
				best, bestName = base, name
			end
		end
	end
	if not best then return nil end
	return { name = bestName, level = best.req and best.req.level or 0 }
end

-- Raw facts about each equipped item, for the "gear check" (the app applies the rules).
function commands.audit_items()
	requireBuild()
	local charLevel = build.characterLevel or 1
	local out = {}
	for _, slot in ipairs(build.itemsTab.orderedSlots) do
		if not slot.inactive and slot.selItemId and slot.selItemId ~= 0 then
			local item = build.itemsTab.items[slot.selItemId]
			if item and item.base then
				local filled = 0
				for _, rune in ipairs(item.runes or {}) do
					if rune and rune ~= "None" and rune ~= "" then filled = filled + 1 end
				end
				-- PoB may infer runes from "(rune)" lines; count those lines as a fallback.
				filled = math.max(filled, math.min(#(item.runeModLines or {}), item.itemSocketCount or 0))
				local best = bestBaseFor(item, charLevel)
				out[#out + 1] = {
					slot = slot.slotName,
					name = item.name,
					rarity = item.rarity,
					base = item.baseName,
					corrupted = item.corrupted and true or false,
					mirrored = item.mirrored and true or false,
					itemLevel = item.itemLevel,
					quality = item.quality or 0,
					maxQuality = item.base.quality or 0,
					baseLevel = item.base.req and item.base.req.level or 0,
					sockets = item.itemSocketCount or 0,
					socketLimit = item.base.socketLimit or 0,
					runesFilled = filled,
					explicitLines = #(item.explicitModLines or {}),
					-- PoE 2: rare = 3 prefixes + 3 suffixes (jewels 4 in total), magic = 1 + 1.
					affixLimit = (item.affixLimit and item.affixLimit > 0) and item.affixLimit
						or (item.rarity == "RARE" and (item.type == "Jewel" and 4 or 6))
						or (item.rarity == "MAGIC" and 2) or 0,
					bestBase = best,
				}
			end
		end
	end
	return { characterLevel = charLevel, items = out }
end

-- Mod line text with ranges resolved ("+(80-100) to maximum Life" → "+90 to maximum Life").
local function resolvedLines(modLines)
	local out = {}
	for _, ml in ipairs(modLines or {}) do
		if not ml.disabled then
			local line = ml.line
			if ml.range then
				line = itemLib.applyRange(ml.line, ml.range, ml.valueScalar) or ml.line
			end
			line = line:gsub("%^x%x%x%x%x%x%x", ""):gsub("%^%d", "")
			if not itemLib.isZeroValueLine(line) then out[#out + 1] = line end
		end
	end
	return out
end

-- Every equipped item with its raw text (re-usable with compare_item) and its mod lines.
function commands.items_detail()
	requireBuild()
	local out = {}
	for _, slot in ipairs(build.itemsTab.orderedSlots) do
		if not slot.inactive and slot.selItemId and slot.selItemId ~= 0 then
			local item = build.itemsTab.items[slot.selItemId]
			if item and item.base then
				local ok, raw = pcall(function() return item:BuildRaw() end)
				out[#out + 1] = {
					slot = slot.slotName,
					name = item.name,
					title = item.title,
					rarity = item.rarity,
					base = item.baseName,
					raw = ok and raw or item.raw,
					implicits = resolvedLines(item.implicitModLines),
					explicits = resolvedLines(item.explicitModLines),
					runes = resolvedLines(item.runeModLines),
				}
			end
		end
	end
	return { items = out }
end

-- Allocated passives (class, ascendancy, keystones, notables, small nodes, jewel sockets).
function commands.tree_detail()
	requireBuild()
	local nodes = {}
	local used = 0
	for id, node in pairs(build.spec.allocNodes) do
		local t = node.type
		if t ~= "ClassStart" and t ~= "AscendClassStart" and t ~= "OnlyImage" then
			local kind = node.ascendancyName and "ascendancy"
				or (t == "Keystone" and "keystone")
				or (t == "Notable" and "notable")
				or (t == "Socket" and "jewel")
				or "normal"
			if not node.ascendancyName then used = used + 1 end
			nodes[#nodes + 1] = { id = id, name = node.dn, kind = kind }
		end
	end
	return {
		className = build.spec.curClassName,
		ascendancy = build.spec.curAscendClassName,
		pointsUsed = used,
		nodes = nodes,
	}
end

-- Skill gems by socket group: active skills with their supports, level and quality.
function commands.skills_detail()
	requireBuild()
	local groups = {}
	for _, group in ipairs(build.skillsTab.socketGroupList) do
		local gems = {}
		for _, gem in ipairs(group.gemList or {}) do
			local granted = gem.gemData and gem.gemData.grantedEffect
				or (gem.skillId and data.skills[gem.skillId])
			local name = (granted and granted.name) or gem.nameSpec
			if name and name ~= "" then
				gems[#gems + 1] = {
					name = name,
					level = gem.level or 0,
					quality = gem.quality or 0,
					support = (granted and granted.support) and true or false,
					enabled = gem.enabled ~= false,
				}
			end
		end
		if #gems > 0 then
			groups[#groups + 1] = {
				label = group.label,
				slot = group.slot,
				enabled = group.enabled ~= false,
				gems = gems,
			}
		end
	end
	return { groups = groups }
end

-- Gain from allocating a single passive node (by node id).
function commands.compare_node(req)
	requireBuild()
	local node = build.spec.nodes[tonumber(req.nodeId)]
	if not node then error("unknown node " .. tostring(req.nodeId)) end
	local calcFunc, baseOutput = build.calcsTab:GetMiscCalculator()
	local newOutput = calcFunc({ addNodes = { [node] = true } })
	local before = pickStats(baseOutput)
	local after = pickStats(newOutput)
	return { node = { id = node.id, name = node.dn }, before = before, after = after, diff = diff(before, after) }
end

---------------------------------------------------------------------------
-- Main loop
---------------------------------------------------------------------------
local function respond(payload)
	realStdout:write(RESPONSE_PREFIX, json.encode(payload), "\n")
	realStdout:flush()
end

respond({ id = 0, ok = true, result = { ready = true } })

for line in io.lines() do
	if line ~= "" then
		local okDecode, req = pcall(json.decode, line)
		if not okDecode or type(req) ~= "table" then
			respond({ id = nil, ok = false, error = "invalid JSON request" })
		elseif req.cmd == "quit" then
			respond({ id = req.id, ok = true, result = {} })
			break
		else
			local handler = commands[req.cmd]
			if not handler then
				respond({ id = req.id, ok = false, error = "unknown command: " .. tostring(req.cmd) })
			else
				local ok, result = xpcall(handler, debug.traceback, req)
				if ok then
					respond({ id = req.id, ok = true, result = result })
				else
					respond({ id = req.id, ok = false, error = tostring(result) })
				end
			end
		end
	end
end
