using UnrealBuildTool;

public class StormIsleTarget : TargetRules
{
	public StormIsleTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("StormIsle");
	}
}
