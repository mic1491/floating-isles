using UnrealBuildTool;

public class DragonRiderEditorTarget : TargetRules
{
	public DragonRiderEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("DragonRider");
	}
}
