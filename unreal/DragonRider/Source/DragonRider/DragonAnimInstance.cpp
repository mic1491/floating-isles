#include "DragonAnimInstance.h"
#include "Animation/AnimNodeBase.h"
#include "Animation/AnimSingleNodeInstanceProxy.h"
#include "Components/SkeletalMeshComponent.h"
#include "Engine/SkeletalMesh.h"
#include "ReferenceSkeleton.h"

namespace
{
	/** Runs on the animation worker thread, so it works from values copied over in PreUpdate. */
	struct FDragonAnimProxy : public FAnimSingleNodeInstanceProxy
	{
		explicit FDragonAnimProxy(UAnimInstance* InAnimInstance) : FAnimSingleNodeInstanceProxy(InAnimInstance) {}

		float JawOpen = 0.f;
		float JawDegrees = 28.f;
		FName JawBone;
		FQuat JawParentRest = FQuat::Identity;

		virtual void PreUpdate(UAnimInstance* InAnimInstance, float DeltaSeconds) override
		{
			FAnimSingleNodeInstanceProxy::PreUpdate(InAnimInstance, DeltaSeconds);
			if (const UDragonAnimInstance* Dragon = Cast<UDragonAnimInstance>(InAnimInstance))
			{
				JawOpen = Dragon->JawOpen;
				JawDegrees = Dragon->JawDegrees;
				JawBone = Dragon->JawBone;
				JawParentRest = Dragon->JawParentRest;
			}
		}

		virtual bool Evaluate(FPoseContext& Output) override
		{
			const bool bResult = FAnimSingleNodeInstanceProxy::Evaluate(Output);
			if (JawOpen > 0.001f)
			{
				const FBoneContainer& Bones = Output.Pose.GetBoneContainer();
				const int32 MeshIndex = Bones.GetPoseBoneIndexForBoneName(JawBone);
				if (MeshIndex != INDEX_NONE)
				{
					const FCompactPoseBoneIndex Index = Bones.MakeCompactPoseIndex(FMeshPoseBoneIndex(MeshIndex));
					if (Index != INDEX_NONE)
					{
						// The mesh faces +Y, so its side-to-side axis is X; a negative turn about it drops the chin.
						const FQuat Swing(FVector(1.0, 0.0, 0.0), FMath::DegreesToRadians(-JawDegrees * JawOpen));
						FTransform& Jaw = Output.Pose[Index];
						Jaw.SetRotation((JawParentRest.Inverse() * Swing * JawParentRest * Jaw.GetRotation()).GetNormalized());
					}
				}
			}
			return bResult;
		}
	};
}

void UDragonAnimInstance::NativeInitializeAnimation()
{
	Super::NativeInitializeAnimation();
	const USkeletalMeshComponent* Comp = GetSkelMeshComponent();
	const USkeletalMesh* Asset = Comp ? Comp->GetSkeletalMeshAsset() : nullptr;
	if (!Asset)
	{
		return;
	}
	const FReferenceSkeleton& Skel = Asset->GetRefSkeleton();
	FQuat Rest = FQuat::Identity;
	for (int32 i = Skel.GetParentIndex(Skel.FindBoneIndex(JawBone)); i != INDEX_NONE; i = Skel.GetParentIndex(i))
	{
		Rest = Skel.GetRefBonePose()[i].GetRotation() * Rest;
	}
	JawParentRest = Rest;
}

FAnimInstanceProxy* UDragonAnimInstance::CreateAnimInstanceProxy()
{
	return new FDragonAnimProxy(this);
}
