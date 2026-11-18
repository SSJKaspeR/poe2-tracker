-- Generates the tree + gems test fixtures (PoB XML on stdout between markers).
-- Run from the PoB src/ directory:
--   luajit <repo>/tests/fixtures/make-tree-gems.lua player|guide
-- then scripts/fixtures compress the XML into a build code.

local which = arg[1] or "player"
print = function(...) io.stderr:write(table.concat({ ... }, "\t"), "\n") end
local realRead = io.read
io.read = function() return nil end
dofile("HeadlessWrapper.lua")
io.read = realRead

newBuild()

local function nearest(kind, skip)
	local best
	for _, node in pairs(build.spec.nodes) do
		if node.type == kind and not node.ascendancyName and node.path and not node.alloc and not (skip and skip[node.id]) then
			if not best or #node.path < #best.path then best = node end
		end
	end
	return best
end

local function alloc(node)
	build.spec:AllocNode(node)
	build.spec:BuildAllDependsAndPaths()
end

local first = nearest("Notable")
alloc(first)
if which == "guide" then
	alloc(nearest("Notable"))
	alloc(nearest("Keystone"))
end

local function gem(id, level, quality)
	local g = data.gems["Metadata/Items/Gems/" .. id]
	assert(g, id)
	return {
		nameSpec = g.name, gemId = id, skillId = g.grantedEffectId, gemData = g,
		level = level, quality = quality, enabled = true, enableGlobal1 = true, count = 1,
		statSet = { index = 1 }, statSetCalcs = { index = 1 },
	}
end

local groups
if which == "guide" then
	groups = {
		{ gem("SkillGemLightningArrow", 20, 20), gem("SkillGemLightningPenetrationSupport", 20, 0), gem("SkillGemMultishotSupport", 20, 0) },
		{ gem("SkillGemIceNova", 20, 0) },
	}
else
	groups = {
		{ gem("SkillGemLightningArrow", 15, 0), gem("SkillGemLightningPenetrationSupport", 10, 0) },
	}
end
for _, list in ipairs(groups) do
	local group = { enabled = true, label = "", mainActiveSkill = 1, mainActiveSkillCalcs = 1, gemList = list }
	table.insert(build.skillsTab.socketGroupList, group)
	build.skillsTab:ProcessSocketGroup(group)
end
build.mainSocketGroup = 1
build.buildFlag = true
runCallback("OnFrame")

io.stdout:write("@@XML@@\n", build:SaveDB("fixture"), "\n@@END@@\n")
