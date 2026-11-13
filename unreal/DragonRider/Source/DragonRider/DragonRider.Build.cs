using UnrealBuildTool;

public class DragonRider : ModuleRules
{
	public DragonRider(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] {
			"Core", "CoreUObject", "Engine", "InputCore", "ProceduralMeshComponent", "SlateCore"
		});
	}
}
