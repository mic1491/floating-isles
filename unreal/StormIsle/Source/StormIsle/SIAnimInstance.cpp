#include "SIAnimInstance.h"
#include "Animation/AnimInstanceProxy.h"
#include "Animation/AnimNodeBase.h"
#include "Animation/AnimSequenceBase.h"
#include "AnimationRuntime.h"

namespace
{
	UAnimSequenceBase* LoadAnim(const TCHAR* Name)
	{
		return LoadObject<UAnimSequenceBase>(nullptr, *FString::Printf(TEXT("/Game/Characters/Mannequins/Anims/%s"), Name), nullptr, LOAD_NoWarn | LOAD_Quiet);
	}

	/** Runs on the animation worker thread, from values copied over in PreUpdate. */
	struct FSIAnimProxy : public FAnimInstanceProxy
	{
		explicit FSIAnimProxy(UAnimInstance* In) : FAnimInstanceProxy(In) {}

		const UAnimSequenceBase* Idle = nullptr;
		const UAnimSequenceBase* Walk = nullptr;
		const UAnimSequenceBase* Jog = nullptr;
		const UAnimSequenceBase* Fall = nullptr;
		const UAnimSequenceBase* Action = nullptr;
		float IdleTime = 0.f, MoveTime = 0.f, FallTime = 0.f, ActionTime = 0.f;
		float WalkWeight = 0.f, JogWeight = 0.f, FallWeight = 0.f, ActionWeight = 0.f;

		virtual void PreUpdate(UAnimInstance* InAnimInstance, float DeltaSeconds) override
		{
			FAnimInstanceProxy::PreUpdate(InAnimInstance, DeltaSeconds);
			if (const USIAnimInstance* A = Cast<USIAnimInstance>(InAnimInstance))
			{
				Idle = A->Idle; Walk = A->Walk; Jog = A->Jog; Fall = A->Fall; Action = A->Action;
				IdleTime = A->IdleTime; MoveTime = A->MoveTime; FallTime = A->FallTime; ActionTime = A->ActionTime;
				WalkWeight = A->WalkWeight; JogWeight = A->JogWeight; FallWeight = A->FallWeight; ActionWeight = A->ActionWeight;
			}
		}

		static void Sample(const UAnimSequenceBase* Anim, float Time, FPoseContext& Out)
		{
			FAnimationPoseData Data(Out);
			Anim->GetAnimationPose(Data, FAnimExtractContext(double(Time), false));
		}

		/** Out becomes Out * (1 - Weight) + Anim * Weight. */
		static void BlendIn(FPoseContext& Out, const UAnimSequenceBase* Anim, float Time, float Weight)
		{
			if (!Anim || Weight <= 0.001f)
			{
				return;
			}
			FPoseContext Other(Out);
			Sample(Anim, Time, Other);
			if (Weight >= 0.999f)
			{
				Out.Pose.CopyBonesFrom(Other.Pose);
				Out.Curve.CopyFrom(Other.Curve);
				return;
			}
			FPoseContext Result(Out);
			FAnimationPoseData A(Out), B(Other), R(Result);
			FAnimationRuntime::BlendTwoPosesTogether(A, B, 1.f - Weight, R);
			Out.Pose.CopyBonesFrom(Result.Pose);
			Out.Curve.CopyFrom(Result.Curve);
		}

		virtual bool Evaluate(FPoseContext& Output) override
		{
			if (!Idle)
			{
				Output.ResetToRefPose();
				return true;
			}
			Sample(Idle, IdleTime, Output);
			const float Move = WalkWeight + JogWeight;
			if (Move > 0.001f && Walk && Jog)
			{
				// Walk and jog share one step cycle, so the feet line up as one gives way to the other.
				FPoseContext Moving(Output);
				Sample(Walk, MoveTime * Walk->GetPlayLength(), Moving);
				BlendIn(Moving, Jog, MoveTime * Jog->GetPlayLength(), JogWeight / Move);
				FPoseContext Result(Output);
				FAnimationPoseData A(Output), B(Moving), R(Result);
				FAnimationRuntime::BlendTwoPosesTogether(A, B, 1.f - FMath::Min(Move, 1.f), R);
				Output.Pose.CopyBonesFrom(Result.Pose);
				Output.Curve.CopyFrom(Result.Curve);
			}
			BlendIn(Output, Fall, FallTime, FallWeight);
			BlendIn(Output, Action, ActionTime, ActionWeight);

			// The clips carry their travel in the root bone; the character moves itself, so pin the root.
			const FCompactPoseBoneIndex Root(0);
			if (Output.Pose.IsValidIndex(Root))
			{
				Output.Pose[Root] = Output.Pose.GetRefPose(Root);
			}
			return true;
		}
	};
}

void USIAnimInstance::NativeInitializeAnimation()
{
	Super::NativeInitializeAnimation();
	Idle = LoadAnim(TEXT("Unarmed/MM_Idle.MM_Idle"));
	Walk = LoadAnim(TEXT("Unarmed/Walk/MF_Unarmed_Walk_Fwd.MF_Unarmed_Walk_Fwd"));
	Jog = LoadAnim(TEXT("Unarmed/Jog/MF_Unarmed_Jog_Fwd.MF_Unarmed_Jog_Fwd"));
	Fall = LoadAnim(TEXT("Unarmed/Jump/MM_Fall_Loop.MM_Fall_Loop"));
}

float USIAnimInstance::PlayAction(UAnimSequenceBase* Anim, float Rate, bool bHoldLastFrame)
{
	if (!Anim)
	{
		return 0.f;
	}
	Action = Anim;
	ActionTime = 0.f;
	ActionRate = Rate;
	bHold = bHoldLastFrame;
	return Anim->GetPlayLength() / Rate;
}

void USIAnimInstance::StopAction()
{
	bHold = false;
	if (Action)
	{
		ActionTime = FMath::Max(ActionTime, Action->GetPlayLength() - 0.2f);
	}
}

void USIAnimInstance::NativeUpdateAnimation(float Dt)
{
	Super::NativeUpdateAnimation(Dt);

	if (Idle)
	{
		IdleTime = FMath::Fmod(IdleTime + Dt, Idle->GetPlayLength());
	}

	// How much of the walk and the jog to show, and how fast to step.
	const float S = FMath::Max(Speed, 0.f);
	float W = 0.f, J = 0.f;
	if (S < WalkSpeed)
	{
		W = S / WalkSpeed;
	}
	else
	{
		J = FMath::Clamp((S - WalkSpeed) / (JogSpeed - WalkSpeed), 0.f, 1.f);
		W = 1.f - J;
	}
	const float Blend = FMath::Min(Dt * 10.f, 1.f);
	WalkWeight = FMath::Lerp(WalkWeight, W, Blend);
	JogWeight = FMath::Lerp(JogWeight, J, Blend);
	if (Walk && Jog)
	{
		const float WalkCycles = FMath::Max(S, 40.f) / WalkSpeed / Walk->GetPlayLength();
		const float JogCycles = FMath::Max(S, 40.f) / JogSpeed / Jog->GetPlayLength();
		MoveTime = FMath::Fmod(MoveTime + Dt * (S < WalkSpeed ? WalkCycles : FMath::Lerp(WalkCycles, JogCycles, J)), 1.f);
	}

	FallWeight = FMath::FInterpTo(FallWeight, bInAir ? 1.f : 0.f, Dt, 8.f);
	if (Fall)
	{
		FallTime = FMath::Fmod(FallTime + Dt, Fall->GetPlayLength());
	}

	// One-off actions fade in quickly and out over their last fifth of a second.
	if (Action)
	{
		const float Len = Action->GetPlayLength();
		ActionTime += Dt * ActionRate;
		if (bHold)
		{
			ActionTime = FMath::Min(ActionTime, Len);
			ActionWeight = FMath::Min(ActionWeight + Dt * 8.f, 1.f);
		}
		else if (ActionTime >= Len)
		{
			Action = nullptr;
			ActionWeight = 0.f;
		}
		else
		{
			const float In = FMath::Min(ActionTime / 0.12f, 1.f);
			const float Out = FMath::Clamp((Len - ActionTime) / 0.2f, 0.f, 1.f);
			ActionWeight = FMath::Min(In, Out);
		}
	}
}

FAnimInstanceProxy* USIAnimInstance::CreateAnimInstanceProxy()
{
	return new FSIAnimProxy(this);
}
