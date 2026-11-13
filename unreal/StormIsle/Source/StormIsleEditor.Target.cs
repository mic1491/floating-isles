using UnrealBuildTool;

public class StormIsleEditorTarget : TargetRules
{
	public StormIsleEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("StormIsle");
	}
}
