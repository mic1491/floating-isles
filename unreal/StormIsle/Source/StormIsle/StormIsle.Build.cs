using UnrealBuildTool;

public class StormIsle : ModuleRules
{
	public StormIsle(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] {
			"Core", "CoreUObject", "Engine", "InputCore", "ProceduralMeshComponent", "SlateCore", "AIModule"
		});
	}
}
