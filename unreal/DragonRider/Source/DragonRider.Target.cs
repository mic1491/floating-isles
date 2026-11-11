using UnrealBuildTool;

public class DragonRiderTarget : TargetRules
{
	public DragonRiderTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("DragonRider");
	}
}
