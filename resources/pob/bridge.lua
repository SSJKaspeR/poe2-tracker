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
	item:NormaliseQuality()
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
